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

import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fireEvent, waitFor, within} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';

class TestModel {
  readonly sent: unknown[] = [];
  private readonly attributes = new Map<string, unknown>();

  constructor(messageLog: unknown[]) {
    this.attributes.set('message_log', messageLog);
  }

  get(name: string): unknown {
    return this.attributes.get(name);
  }

  on(): void {}

  off(): void {}

  send(content: unknown): void {
    this.sent.push(content);
  }
}

const widgetUrl = pathToFileURL(
  resolve(process.cwd(), '../../../python/a2ui_jupyter/src/a2ui_jupyter/static/widget.js'),
);

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById('a2ui-structural-styles')?.remove();
});

describe('built anywidget module', () => {
  it('renders a replayed A2UI surface', async () => {
    const widgetModule = (await import(/* @vite-ignore */ widgetUrl.href)) as {
      default: {
        render: (context: {model: TestModel; el: HTMLElement}) => () => void;
      };
    };
    const model = new TestModel([
      {
        sequence: 0,
        message: {
          version: '1.0',
          createSurface: {
            surfaceId: 'manual-smoke-test',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
          },
        },
      },
      {
        sequence: 1,
        message: {
          version: '1.0',
          updateDataModel: {
            surfaceId: 'manual-smoke-test',
            path: '/person/name',
            value: 'Ada',
          },
        },
      },
      {
        sequence: 2,
        message: {
          version: '1.0',
          updateDataModel: {
            surfaceId: 'manual-smoke-test',
            path: '/status',
            value: 'Waiting for **submission**',
          },
        },
      },
      {
        sequence: 3,
        message: {
          version: '1.0',
          updateComponents: {
            surfaceId: 'manual-smoke-test',
            components: [
              {id: 'root', component: 'Column', children: ['name', 'submit', 'status']},
              {
                id: 'name',
                component: 'TextField',
                label: 'Name',
                value: {'@path': '/person/name'},
              },
              {
                id: 'submit',
                component: 'Button',
                child: 'submit-label',
                action: {
                  event: {
                    name: 'submit',
                    context: {name: {'@path': '/person/name'}},
                  },
                },
              },
              {id: 'submit_label', component: 'Text', text: 'Submit'},
              {id: 'status', component: 'Text', text: {'@path': '/status'}},
            ],
          },
        },
      },
    ]);
    const element = document.createElement('div');
    document.body.append(element);

    const dispose = widgetModule.default.render({model, el: element});
    await waitFor(() => expect(within(element).getByRole('button')).toBeInTheDocument());
    expect(element).toHaveTextContent('Waiting for submission');
    await waitFor(() => expect(element.querySelector('strong')).toHaveTextContent('submission'));
    expect(model.sent).toEqual([]);
    fireEvent.click(within(element).getByRole('button'));
    await waitFor(() => expect(model.sent).toHaveLength(1));
    expect(model.sent[0]).toMatchObject({
      message: {action: {name: 'submit', context: {name: 'Ada'}}},
    });

    dispose();
  });
});
