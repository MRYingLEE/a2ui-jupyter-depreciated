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

import {fireEvent, waitFor, within} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {AgentFunction} from '@a2ui/web_core';
import {
  basicCatalog as v1BasicCatalog,
  setMarkdownRenderer,
} from '@a2ui/web_core/catalogs/basic/v1';
import {z} from 'zod';
import widget, {mountA2uiWidget} from '../src/widget';

class TestModel {
  readonly sent: unknown[] = [];
  private readonly attributes = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<(content: unknown) => void>>();

  constructor(messageLog: unknown[] = []) {
    this.attributes.set('message_log', messageLog);
  }

  get(name: string): unknown {
    return this.attributes.get(name);
  }

  on(eventName: string, handler: (content: unknown) => void): void {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(handler);
    this.listeners.set(eventName, listeners);
  }

  off(eventName: string, handler: (content: unknown) => void): void {
    this.listeners.get(eventName)?.delete(handler);
  }

  send(content: unknown): void {
    this.sent.push(content);
  }

  emit(content: unknown): void {
    for (const listener of this.listeners.get('msg:custom') ?? []) {
      listener(content);
    }
  }

  changeAttribute(name: string, value: unknown): void {
    this.attributes.set(name, value);
    for (const listener of this.listeners.get(`change:${name}`) ?? []) {
      listener(value);
    }
  }
}

const createMessage = (sequence: number, message: unknown) => ({sequence, message});

function surfaceMessages(components: unknown[]) {
  return [
    {
      version: '1.0',
      createSurface: {surfaceId: 'surface-1', catalogId: v1BasicCatalog.id},
    },
    {
      version: '1.0',
      updateDataModel: {
        surfaceId: 'surface-1',
        path: '/',
        value: {greeting: 'Hello, Ada', name: 'Ada'},
      },
    },
    {
      version: '1.0',
      updateComponents: {surfaceId: 'surface-1', components},
    },
  ];
}

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById('a2ui-structural-styles')?.remove();
  setMarkdownRenderer(undefined);
  vi.restoreAllMocks();
});

describe('Jupyter widget bridge', () => {
  it('renders Markdown safely without a missing renderer warning', async () => {
    const warning = vi.spyOn(console, 'warn');
    const messages = surfaceMessages([
      {id: 'root', component: 'Text', text: '**Bold** <img src=x onerror=alert(1)>'},
    ]);
    const model = new TestModel(
      messages.map((message, sequence) => createMessage(sequence, message)),
    );
    const element = document.createElement('div');
    document.body.append(element);
    const dispose = mountA2uiWidget(model, element);

    await waitFor(() => expect(element.querySelector('strong')).toHaveTextContent('Bold'));
    expect(element.querySelector('img')).toBeNull();
    expect(warning.mock.calls.flat().join(' ')).not.toContain('no markdown renderer');
    dispose();
  });

  it('replays the ordered message log and applies live updates', async () => {
    const messages = surfaceMessages([
      {id: 'root', component: 'Column', children: ['label']},
      {id: 'label', component: 'Text', text: {'@path': '/greeting'}},
    ]);
    const model = new TestModel(
      messages.map((message, sequence) => createMessage(sequence, message)),
    );
    const element = document.createElement('div');
    document.body.append(element);
    const dispose = mountA2uiWidget(model, element);

    await waitFor(() => expect(element).toHaveTextContent('Hello, Ada'));
    model.emit({
      type: 'a2ui',
      sequence: 3,
      message: {
        version: '1.0',
        updateDataModel: {
          surfaceId: 'surface-1',
          path: '/greeting',
          value: 'Hello, Lin',
        },
      },
    });

    await waitFor(() => expect(element).toHaveTextContent('Hello, Lin'));
    dispose();
    expect(element).toBeEmptyDOMElement();
  });

  it('applies a message log that is synced after the view mounts', async () => {
    const messages = surfaceMessages([
      {id: 'root', component: 'Column', children: ['label']},
      {id: 'label', component: 'Text', text: {'@path': '/greeting'}},
    ]);
    const log = messages.map((message, sequence) => createMessage(sequence, message));
    const model = new TestModel(log.slice(0, 1));
    const element = document.createElement('div');
    document.body.append(element);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispose = mountA2uiWidget(model, element);

    model.emit({type: 'a2ui', ...log[2]});
    model.changeAttribute('message_log', log);

    await waitFor(() => expect(element).toHaveTextContent('Hello, Ada'));
    expect(errorSpy).not.toHaveBeenCalled();
    dispose();
  });

  it('renders surfaces from a later evaluation of the widget module', async () => {
    const messages = surfaceMessages([{id: 'root', component: 'Text', text: 'Hello, Grace'}]);
    const log = messages.map((message, sequence) => createMessage(sequence, message));
    const firstElement = document.createElement('div');
    const firstModel = new TestModel(log);
    document.body.append(firstElement);
    const disposeFirst = widget.render({model: firstModel, el: firstElement});

    vi.resetModules();
    const laterWidget = (await import('../src/widget')).default;
    const element = document.createElement('div');
    const model = new TestModel(log);
    document.body.append(element);
    const dispose = laterWidget.render({model, el: element});

    await waitFor(() => expect(element).toHaveTextContent('Hello, Grace'));
    dispose();
    disposeFirst();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('@a2ui/jupyter/mountA2uiWidget')];
  });

  it('sends an action only after resolving its context', async () => {
    const messages = surfaceMessages([
      {
        id: 'root',
        component: 'Button',
        child: 'label',
        action: {event: {name: 'submit', context: {name: {'@path': '/name'}}}},
      },
      {id: 'label', component: 'Text', text: 'Submit'},
    ]);
    const model = new TestModel(
      messages.map((message, sequence) => createMessage(sequence, message)),
    );
    const element = document.createElement('div');
    document.body.append(element);
    const dispose = mountA2uiWidget(model, element);

    await waitFor(() => expect(within(element).getByRole('button')).toBeInTheDocument());
    fireEvent.click(within(element).getByRole('button'));

    await waitFor(() => expect(model.sent).toHaveLength(1));
    expect(model.sent[0]).toMatchObject({
      type: 'a2ui',
      message: {
        version: '1.0',
        action: {
          name: 'submit',
          surfaceId: 'surface-1',
          sourceComponentId: 'root',
          context: {name: 'Ada'},
        },
      },
    });
    dispose();
  });

  it('hides a submitted surface until replacement components arrive', async () => {
    const messages = surfaceMessages([
      {
        id: 'root',
        component: 'Button',
        child: 'label',
        action: {event: {name: 'submit', context: {name: {'@path': '/name'}}}},
      },
      {id: 'label', component: 'Text', text: 'Submit'},
    ]);
    const model = new TestModel(
      messages.map((message, sequence) => createMessage(sequence, message)),
    );
    const element = document.createElement('div');
    document.body.append(element);
    const dispose = mountA2uiWidget(model, element);

    await waitFor(() => expect(within(element).getByRole('button')).toBeInTheDocument());
    fireEvent.click(within(element).getByRole('button'));

    await waitFor(() => expect(model.sent).toHaveLength(1));
    await waitFor(() => expect(within(element).queryByRole('button')).toBeNull());

    model.emit({
      type: 'a2ui',
      sequence: 3,
      message: {
        version: '1.0',
        updateComponents: {
          surfaceId: 'surface-1',
          components: [{id: 'root', component: 'Text', text: 'Submitted'}],
        },
      },
    });

    await waitFor(() => expect(element).toHaveTextContent('Submitted'));
    dispose();
  });

  it('routes agent function calls and matching responses through the kernel', async () => {
    const agentCatalog = v1BasicCatalog.copyWith({
      agentFunctions: [
        new AgentFunction({
          name: 'lookup',
          returnType: 'string',
          schema: z.object({query: z.string()}),
          handler: () => 'unused in the renderer',
        }),
      ],
    });
    const messages = surfaceMessages([
      {
        id: 'root',
        component: 'Button',
        child: 'label',
        action: {
          event: {
            name: 'lookup',
            context: {result: {'@call': 'lookup', 'args': {query: 'Ada'}}},
          },
        },
      },
      {id: 'label', component: 'Text', text: 'Look up'},
    ]);
    const model = new TestModel(
      messages.map((message, sequence) => createMessage(sequence, message)),
    );
    const element = document.createElement('div');
    document.body.append(element);
    const dispose = mountA2uiWidget(model, element, [agentCatalog]);

    await waitFor(() => expect(within(element).getByRole('button')).toBeInTheDocument());
    fireEvent.click(within(element).getByRole('button'));

    await waitFor(() => expect(model.sent.length).toBeGreaterThanOrEqual(1));
    const call = model.sent[0];
    expect(call).toMatchObject({
      type: 'a2ui',
      message: {
        version: '1.0',
        callAgentFunction: {
          surfaceId: 'surface-1',
          callFunction: {
            '@call': 'lookup',
            args: {query: 'Ada'},
          },
        },
      },
    });
    const callFunctionId = (
      call as {
        message: {callAgentFunction: {functionCallId: string}};
      }
    ).message.callAgentFunction.functionCallId;

    model.emit({
      type: 'a2ui',
      sequence: 3,
      message: {
        version: '1.0',
        agentFunctionResponse: {functionCallId: callFunctionId, value: 'found'},
      },
    });

    await waitFor(() => expect(model.sent).toHaveLength(2));
    expect(model.sent[1]).toMatchObject({
      type: 'a2ui',
      message: {
        version: '1.0',
        action: {name: 'lookup', context: {result: 'found'}},
      },
    });
    dispose();
  });

  it('returns renderer function results and reports protocol errors to Python', async () => {
    const model = new TestModel();
    const element = document.createElement('div');
    document.body.append(element);
    const dispose = mountA2uiWidget(model, element);

    model.emit({
      type: 'a2ui',
      sequence: 0,
      message: {
        version: '1.0',
        callRendererFunction: {
          functionCallId: 'renderer-call-1',
          callFunction: {
            '@call': 'missingFunction',
            catalogId: v1BasicCatalog.id,
            args: {},
          },
        },
      },
    });

    await waitFor(() => expect(model.sent).toHaveLength(1));
    expect(model.sent[0]).toMatchObject({
      type: 'a2ui',
      message: {
        version: '1.0',
        rendererFunctionResponse: {
          functionCallId: 'renderer-call-1',
          error: {code: expect.any(String)},
        },
      },
    });

    model.emit({
      type: 'a2ui',
      sequence: 1,
      message: {
        version: '1.0',
        createSurface: {surfaceId: 'bad-surface', catalogId: 'https://example.com/missing'},
      },
    });

    await waitFor(() => expect(model.sent).toHaveLength(2));
    expect(model.sent[1]).toMatchObject({
      type: 'a2ui',
      message: {
        version: '1.0',
        error: {code: expect.any(String), message: expect.any(String)},
      },
    });
    expect(within(element).getByRole('status')).not.toHaveTextContent('[object Object]');
    dispose();
  });

  it('rejects invalid custom messages visibly instead of passing them to the processor', async () => {
    const model = new TestModel();
    const element = document.createElement('div');
    document.body.append(element);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispose = mountA2uiWidget(model, element);

    model.emit({type: 'other', message: {}});

    expect(within(element).getByRole('status')).toHaveTextContent(
      "Unsupported custom message; expected type 'a2ui'.",
    );
    expect(errorSpy).toHaveBeenCalledOnce();
    dispose();
    errorSpy.mockRestore();
  });
});
