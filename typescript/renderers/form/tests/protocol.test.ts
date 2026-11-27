/*
 * Copyright 2024 Google LLC
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

import fixtureJson from './fixtures/form-builder.json';
import {runInNewContext} from 'node:vm';
import {describe, expect, it} from 'vitest';
import {
  A2UI_INPUT_MARKER,
  A2uiInputCancelled,
  A2uiInputError,
  a2uiForm,
  coerceA2uiFormData,
  createA2uiFormInputRequest,
  createA2uiInputRequest,
  decodeA2uiFormInputReply,
  decodeA2uiInputReply,
  encodeA2uiInputFailure,
  encodeA2uiInputResult,
  parseA2uiInputRequest,
  type A2uiFormField,
  type A2uiFormOptions,
} from '../src/kernel';

const fixture = fixtureJson as unknown as {
  builder: Array<{fields: A2uiFormField[]; options: A2uiFormOptions; messages: unknown[]}>;
  coercion: Array<{
    fields: A2uiFormField[];
    data: Record<string, string>;
    expected?: unknown;
    error?: boolean;
  }>;
};

const messages = a2uiForm([{name: 'answer'}]);

describe('A2UI input protocol', () => {
  it('round-trips a request between kernel and frontend', () => {
    const text = createA2uiInputRequest(messages, {prompt: 'Answer', cancel: []});
    expect(text.startsWith(A2UI_INPUT_MARKER)).toBe(true);
    expect(parseA2uiInputRequest(text)).toEqual({
      messages,
      prompt: 'Answer',
      submit: ['submit'],
      cancel: [],
    });
    expect(parseA2uiInputRequest('plain prompt')).toBeUndefined();
  });

  it.each([
    ['no messages', []],
    ['a first message that is not createSurface', [messages[0], messages[0]]],
    [
      'a second surface',
      [messages[0], {version: '1.0', updateDataModel: {surfaceId: 'other', path: '/', value: {}}}],
    ],
    ['deleteSurface', [messages[0], {version: '1.0', deleteSurface: {surfaceId: 'a2ui-form'}}]],
    ['an old version', [{version: '0.9', createSurface: {surfaceId: 's', catalogId: 'c'}}]],
  ])('rejects %s', (_name, invalid) => {
    expect(() => createA2uiInputRequest(invalid as unknown[])).toThrow(A2uiInputError);
  });

  it('rejects overlapping or invalid action names and marked malformed prompts', () => {
    expect(() => createA2uiInputRequest(messages, {submit: ['go'], cancel: ['go']})).toThrow(
      A2uiInputError,
    );
    expect(() => createA2uiInputRequest(messages, {submit: []})).toThrow(A2uiInputError);
    expect(() => createA2uiInputRequest(messages, {submit: ['has space']})).toThrow(A2uiInputError);
    expect(() => parseA2uiInputRequest(`${A2UI_INPUT_MARKER}{`)).toThrow(A2uiInputError);
    const valid = createA2uiInputRequest(messages).slice(A2UI_INPUT_MARKER.length);
    expect(() =>
      parseA2uiInputRequest(`${A2UI_INPUT_MARKER}{"prompt":"",${valid.slice(1)}`),
    ).toThrow('Duplicate JSON key');
  });

  it('rejects requests over the size limit', () => {
    const big = a2uiForm([{name: 'x', label: 'x'.repeat(300000)}]);
    expect(() => createA2uiInputRequest(big)).toThrow('Request is too large');
  });

  it('decodes results, cancellations and errors', () => {
    const reply = encodeA2uiInputResult({
      action: 'submit',
      context: {},
      data: {answer: '42', skipped: undefined} as never,
    });
    expect(decodeA2uiInputReply(reply, ['submit'])).toEqual({
      action: 'submit',
      context: {},
      data: {answer: '42'},
    });
    expect(() => decodeA2uiInputReply(reply, ['other'])).toThrow('not requested');
    expect(() => decodeA2uiInputReply(encodeA2uiInputFailure(), ['submit'])).toThrow(
      A2uiInputCancelled,
    );
    expect(() => decodeA2uiInputReply(encodeA2uiInputFailure('render_failed'), ['submit'])).toThrow(
      'render_failed',
    );
    expect(() => decodeA2uiInputReply('{"status":"ok"}', ['submit'])).toThrow(A2uiInputError);
  });

  it('accepts plain objects from another realm, such as a kernel iframe', () => {
    const foreign = runInNewContext(
      '[{version: "1.0", createSurface: {surfaceId: "s", catalogId: "c", dataModel: {a: [1]}}}]',
    ) as unknown[];
    expect(parseA2uiInputRequest(createA2uiInputRequest(foreign))?.messages).toEqual([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: 'c', dataModel: {a: [1]}}},
    ]);
  });

  it('refuses values JSON cannot represent exactly', () => {
    for (const data of [{n: Number.NaN}, {n: 2 ** 60}, {d: new Date()}, {m: new Map()}]) {
      expect(() => encodeA2uiInputResult({action: 'submit', context: {}, data} as never)).toThrow(
        A2uiInputError,
      );
    }
  });
});

describe('A2UI form builder', () => {
  it.each(fixture.builder.map(item => [item.messages.length, item] as const))(
    'matches the shared fixture (%#)',
    (_length, item) => {
      expect(a2uiForm(item.fields, item.options)).toEqual(item.messages);
    },
  );

  it('produces requests that the protocol accepts', () => {
    for (const item of fixture.builder) {
      expect(() => createA2uiInputRequest(item.messages)).not.toThrow();
    }
  });

  it.each([
    ['a duplicate name', [{name: 'a'}, {name: 'a'}]],
    ['an invalid name', [{name: '1a'}]],
    ['an unknown type', [{name: 'a', type: 'color'}]],
    ['a choice without options', [{name: 'a', type: 'choice'}]],
    ['a slider without max', [{name: 'a', type: 'slider'}]],
    ['a non-boolean checkbox value', [{name: 'a', type: 'checkbox', value: 'yes'}]],
  ])('rejects %s', (_name, fields) => {
    expect(() => a2uiForm(fields as A2uiFormField[])).toThrow(A2uiInputError);
  });

  it('coerces number fields like the other kernel helpers', () => {
    for (const item of fixture.coercion) {
      if (item.error) {
        expect(() => coerceA2uiFormData(item.fields, item.data)).toThrow(A2uiInputError);
      } else {
        expect(coerceA2uiFormData(item.fields, item.data)).toEqual(item.expected);
      }
    }
  });

  it('builds form input requests and decodes coerced replies', () => {
    const fields: A2uiFormField[] = [{name: 'age', type: 'number'}];
    const options = {prompt: 'Age', submitAction: 'save', cancelLabel: null};
    const request = parseA2uiInputRequest(createA2uiFormInputRequest(fields, options));
    expect(request).toMatchObject({prompt: 'Age', submit: ['save'], cancel: []});
    expect(request?.messages).toEqual(a2uiForm(fields, options));
    const reply = '{"status":"ok","action":"save","context":{},"data":{"age":"7"}}';
    expect(decodeA2uiFormInputReply(fields, reply, options)).toEqual({age: 7});
    expect(() => decodeA2uiFormInputReply(fields, reply)).toThrow('not requested');
  });
});
