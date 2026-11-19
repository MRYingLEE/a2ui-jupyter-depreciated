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

import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createContext, runInContext} from 'node:vm';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

class FakeWidget {
  readonly outgoing: Record<string, unknown>[] = [];
  readonly state: Record<string, unknown>;
  protected _comm = {send: (data: Record<string, unknown>) => this.outgoing.push(data)};

  constructor(state: Record<string, unknown> = {}) {
    this.state = {...state};
  }

  get(name: string): unknown {
    return this.state[name];
  }

  set(name: string, value: unknown): void {
    this.state[name] = value;
  }

  _handleMsg(_data: Record<string, unknown>): void {}
}

interface NotebookCell {
  cell_type: string;
  source: string | string[];
}

interface Notebook {
  cells: NotebookCell[];
}

const examples = resolve(process.cwd(), 'examples');
const pythonExamples = resolve(process.cwd(), '../../../python/a2ui_jupyter/examples');
type Surface = FakeWidget & {send(messages: unknown): void};

function cellSource(cell: NotebookCell): string {
  return typeof cell.source === 'string' ? cell.source : cell.source.join('');
}

function messages(surface: Surface): unknown[] {
  return surface.outgoing.map(data => {
    const content = data['content'] as {message: unknown};
    return content.message;
  });
}

function receive(surface: Surface, message: unknown): void {
  surface._handleMsg({method: 'custom', content: {type: 'a2ui', message}});
}

function action(surfaceId: string, name: string, context: Record<string, unknown>) {
  return {
    version: '1.0',
    action: {
      name,
      surfaceId,
      sourceComponentId: 'button',
      timestamp: '2026-11-11T00:00:00Z',
      context,
    },
  };
}

describe('JavaScript kernel examples', () => {
  let A2UISurface: typeof import('../src/kernel').A2UISurface;

  beforeEach(async () => {
    vi.resetModules();
    (globalThis as {Jupyter?: unknown}).Jupyter = {widgets: {Widget: FakeWidget}};
    ({A2UISurface} = await import('../src/kernel'));
  });

  afterEach(() => {
    delete (globalThis as {Jupyter?: unknown}).Jupyter;
  });

  async function openNotebook(name: string) {
    const notebook = JSON.parse(readFileSync(resolve(examples, name), 'utf8')) as Notebook;
    const cells = notebook.cells.filter(cell => cell.cell_type === 'code');
    const context = createContext({
      A2UISurface,
      display: vi.fn(),
      console,
      setTimeout: (callback: () => void) => callback(),
    });
    const runCell = async (index: number) => {
      const cell = cells[index];
      if (!cell) {
        throw new Error(`Missing code cell ${index} in ${name}`);
      }
      const source = cellSource(cell).replace(
        /^const \{ A2UISurface \} = await import\([^\n]+\);\n/,
        '',
      );
      await runInContext(`(async () => {\n${source}\n})()`, context);
    };
    await runCell(0);
    return {context, runCell, surface: context['surface'] as Surface};
  }

  it('provides a JavaScript notebook for every Python notebook', () => {
    const notebooks = (directory: string) =>
      readdirSync(directory)
        .filter(name => name.endsWith('.ipynb'))
        .sort();
    expect(notebooks(examples)).toEqual(notebooks(pythonExamples));
  });

  it.each(['display(surface);\n', ['display(', 'surface);\n']])(
    'reads a notebook cell source in either supported format',
    source => {
      expect(cellSource({cell_type: 'code', source})).toBe('display(surface);\n');
    },
  );

  it('updates the layout greeting in a later cell', async () => {
    const {surface, runCell} = await openNotebook('01_text_and_layout.ipynb');
    await runCell(1);
    expect(messages(surface).at(-1)).toEqual({
      version: '1.0',
      updateDataModel: {
        surfaceId: 'text-and-layout',
        path: '/greeting',
        value: 'Updated from a later cell',
      },
    });
  });

  it.each([
    [
      '02_button_action.ipynb',
      'button-action',
      'button_clicked',
      {},
      'Received button_clicked from button',
    ],
    [
      '03_login_form.ipynb',
      'login-form',
      'login',
      {email: 'ada@example.com'},
      'Signed in as ada@example.com',
    ],
  ])('handles actions in %s', async (file, surfaceId, name, context, status) => {
    const example = await openNotebook(file);
    const message = action(surfaceId, name, context);
    receive(example.surface, message);
    expect(example.context['actionData']).toEqual(message);
    expect(messages(example.surface).at(-1)).toMatchObject({
      updateDataModel: {surfaceId, path: '/status', value: status},
    });
  });

  it('streams restaurants and applies the later component update', async () => {
    const {surface, runCell} = await openNotebook('04_streaming_updates.ipynb');
    await runCell(1);
    await runCell(2);
    const sent = messages(surface);
    expect(sent.slice(3, 6)).toMatchObject([
      {updateDataModel: {path: '/restaurants/0', value: {title: 'The Golden Fork'}}},
      {updateDataModel: {path: '/restaurants/1', value: {title: "Ocean's Bounty"}}},
      {updateDataModel: {path: '/restaurants/2', value: {title: 'Pizzeria Roma'}}},
    ]);
    expect(sent.at(-2)).toMatchObject({
      updateDataModel: {path: '/restaurants/0/subtitle', value: 'Fine dining, now open late'},
    });
    expect(sent.at(-1)).toMatchObject({
      updateComponents: {
        components: [
          {id: 'root', children: ['heading', 'restaurant_list', 'footer']},
          {id: 'footer', text: 'Updated in place by a later cell'},
        ],
      },
    });
  });

  it('unsubscribes the action and message handlers independently', async () => {
    const {surface, runCell} = await openNotebook('05_event_handlers.ipynb');
    const message = action('event-handlers', 'increment', {step: 2});
    receive(surface, message);
    expect(messages(surface).slice(-2)).toMatchObject([
      {updateDataModel: {path: '/log', value: 'Last renderer message: action'}},
      {updateDataModel: {path: '/count', value: 2}},
    ]);
    await runCell(1);
    receive(surface, message);
    expect(messages(surface).at(-1)).toMatchObject({updateDataModel: {path: '/log'}});
    const count = messages(surface).length;
    await runCell(2);
    receive(surface, message);
    expect(messages(surface)).toHaveLength(count);
  });

  it('answers agent function calls and stops after unsubscribing', async () => {
    const {surface, runCell} = await openNotebook('06_agent_function_call.ipynb');
    const call = {
      version: '1.0',
      callAgentFunction: {
        surfaceId: 'agent-function-call',
        functionCallId: 'forecast-1',
        callFunction: {
          '@call': 'getForecast',
          catalogId: 'https://example.com/catalog.json',
          args: {city: 'Seattle'},
        },
      },
    };
    receive(surface, call);
    expect(messages(surface).slice(-2)).toEqual([
      {
        version: '1.0',
        agentFunctionResponse: {functionCallId: 'forecast-1', value: 'Light rain, 12 C'},
      },
      {
        version: '1.0',
        updateDataModel: {
          surfaceId: 'agent-function-call',
          path: '/forecast',
          value: 'Seattle: Light rain, 12 C',
        },
      },
    ]);
    const count = messages(surface).length;
    await runCell(1);
    receive(surface, call);
    expect(messages(surface)).toHaveLength(count);
  });

  it('replaces the submitted form with a confirmation', async () => {
    const {surface, context} = await openNotebook('manual_smoke_test.ipynb');
    const message = action('manual-smoke-test', 'submit', {name: 'Ada'});
    receive(surface, message);
    expect(context['actionData']).toEqual(message);
    expect(messages(surface).slice(-2)).toMatchObject([
      {updateDataModel: {path: '/status', value: 'Submitted: Ada'}},
      {updateComponents: {components: [{id: 'root', children: ['title', 'status']}]}},
    ]);
  });
});
