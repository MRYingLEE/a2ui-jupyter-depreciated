/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {AgentToRendererMessage, RendererToAgentMessage} from '@a2ui/web_core/v1_0';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

type KernelModule = typeof import('../src/kernel');
type Surface = InstanceType<KernelModule['A2UISurface']>;

class FakeWidget {
  readonly state: Record<string, unknown>;
  readonly outgoing: Record<string, unknown>[] = [];
  protected _comm = {
    send: (data: Record<string, unknown>) => {
      this.outgoing.push(data);
    },
  };

  constructor(state: Record<string, unknown> = {}) {
    this.state = {...state};
  }

  get(name: string): unknown {
    return this.state[name];
  }

  set(name: string, value: unknown): void {
    this.state[name] = value;
  }

  protected _handleMsg(_data: Record<string, unknown>, _buffers?: unknown[]): void {}
}

const SURFACE: AgentToRendererMessage = {
  version: '1.0',
  createSurface: {surfaceId: 'surface-1', catalogId: 'https://example.com/catalog.json'},
};

const DELETE_SURFACE: AgentToRendererMessage = {
  version: '1.0',
  deleteSurface: {surfaceId: 'surface-1'},
};

const ACTION: RendererToAgentMessage = {
  version: '1.0',
  action: {
    name: 'submit',
    surfaceId: 'surface-1',
    sourceComponentId: 'button-1',
    timestamp: '2026-11-11T00:00:00Z',
    context: {name: 'Ada'},
  },
};

const CALL_AGENT_FUNCTION: RendererToAgentMessage = {
  version: '1.0',
  callAgentFunction: {
    surfaceId: 'surface-1',
    functionCallId: 'agent-call-1',
    callFunction: {
      '@call': 'lookup',
      catalogId: 'https://example.com/catalog.json',
      args: {query: 'Ada'},
    },
  },
};

/** Sends a browser message to the surface, as the kernel comm would. */
function receive(surface: Surface, data: Record<string, unknown>): void {
  (surface as unknown as {_handleMsg(data: Record<string, unknown>): void})._handleMsg(data);
}

function receiveBrowserMessage(surface: Surface, message: unknown): void {
  receive(surface, {method: 'custom', content: {type: 'a2ui', message}});
}

function outgoingOf(surface: Surface): Record<string, unknown>[] {
  return (surface as unknown as FakeWidget).outgoing;
}

describe('A2UISurface (JavaScript kernel)', () => {
  let A2UISurface: KernelModule['A2UISurface'];

  beforeEach(async () => {
    vi.resetModules();
    (globalThis as {Jupyter?: unknown}).Jupyter = {widgets: {Widget: FakeWidget}};
    ({A2UISurface} = await import('../src/kernel'));
  });

  afterEach(() => {
    delete (globalThis as {Jupyter?: unknown}).Jupyter;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fails clearly when loaded outside a JavaScript kernel cell', async () => {
    delete (globalThis as {Jupyter?: unknown}).Jupyter;
    vi.resetModules();
    await expect(import('../src/kernel')).rejects.toThrow(/JavaScript kernel cell/);
  });

  it('validates the whole batch before sending anything', () => {
    const surface = new A2UISurface();

    const incomplete = {version: '1.0'} as unknown as AgentToRendererMessage;
    expect(() => surface.send([SURFACE, incomplete])).toThrow(/Invalid A2UI message/);

    expect(outgoingOf(surface)).toEqual([]);
    expect(surface.get('message_log')).toEqual([]);
  });

  it('sends messages with increasing sequence numbers', () => {
    const surface = new A2UISurface();

    surface.send([SURFACE, DELETE_SURFACE]);
    surface.send(SURFACE);

    expect(outgoingOf(surface)).toEqual([
      {method: 'custom', content: {type: 'a2ui', sequence: 0, message: SURFACE}},
      {method: 'custom', content: {type: 'a2ui', sequence: 1, message: DELETE_SURFACE}},
      {method: 'custom', content: {type: 'a2ui', sequence: 2, message: SURFACE}},
    ]);
  });

  it('coalesces log sync into one update after 200 ms', () => {
    vi.useFakeTimers();
    const surface = new A2UISurface();

    surface.send([SURFACE, DELETE_SURFACE]);
    surface.send(SURFACE);
    expect(surface.get('message_log')).toEqual([]);

    vi.advanceTimersByTime(199);
    expect(surface.get('message_log')).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(surface.get('message_log')).toEqual([
      {sequence: 0, message: SURFACE},
      {sequence: 1, message: DELETE_SURFACE},
      {sequence: 2, message: SURFACE},
    ]);
  });

  it('publishes the pending log immediately when the browser requests state', () => {
    vi.useFakeTimers();
    const surface = new A2UISurface();

    surface.send(SURFACE);
    receive(surface, {method: 'request_state'});

    expect(surface.get('message_log')).toEqual([{sequence: 0, message: SURFACE}]);
  });

  it('dispatches browser messages to handlers and queues them in order', () => {
    const surface = new A2UISurface();
    const seen: string[] = [];
    surface.onMessage(message => seen.push(Object.keys(message).join(',')));

    receiveBrowserMessage(surface, CALL_AGENT_FUNCTION);
    receiveBrowserMessage(surface, ACTION);

    expect(seen).toEqual(['version,callAgentFunction', 'version,action']);
    expect(surface.takeMessage()).toEqual(CALL_AGENT_FUNCTION);
    expect(surface.takeMessage()).toEqual(ACTION);
    expect(surface.takeMessage()).toBeUndefined();
  });

  it('routes only action messages to action handlers and queue', () => {
    const surface = new A2UISurface();
    const actions: unknown[] = [];
    surface.onAction(action => actions.push(action));

    receiveBrowserMessage(surface, CALL_AGENT_FUNCTION);
    receiveBrowserMessage(surface, ACTION);

    expect(actions).toEqual([ACTION]);
    expect(surface.takeAction()).toEqual(ACTION);
    expect(surface.takeAction()).toBeUndefined();
  });

  it('ignores invalid browser messages without queueing them', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const surface = new A2UISurface();
    const handler = vi.fn();
    surface.onMessage(handler);

    receiveBrowserMessage(surface, {version: '1.0', action: {name: 'submit'}});

    expect(handler).not.toHaveBeenCalled();
    expect(surface.takeMessage()).toBeUndefined();
    expect(surface.takeAction()).toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring invalid A2UI message'),
    );
  });

  it('keeps delivering to other handlers when one handler throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const surface = new A2UISurface();
    const second = vi.fn();
    surface.onAction(() => {
      throw new Error('boom');
    });
    surface.onAction(second);

    receiveBrowserMessage(surface, ACTION);

    expect(second).toHaveBeenCalledWith(ACTION);
    expect(surface.takeAction()).toEqual(ACTION);
    expect(consoleError).toHaveBeenCalledWith('A2UI handler failed:', expect.any(Error));
  });

  it('stops calling a handler after it is unsubscribed', () => {
    const surface = new A2UISurface();
    const handler = vi.fn();
    const unsubscribe = surface.onMessage(handler);

    unsubscribe();
    receiveBrowserMessage(surface, CALL_AGENT_FUNCTION);

    expect(handler).not.toHaveBeenCalled();
    expect(surface.takeMessage()).toEqual(CALL_AGENT_FUNCTION);
  });
});
