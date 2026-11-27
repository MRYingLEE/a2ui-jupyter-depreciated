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

/**
 * The A2UI input protocol (v1): a kernel sends A2UI v1.0 messages through a
 * Jupyter stdin request, and the frontend replies with the action that ended
 * the form and the surface data model. This module has no dependencies so it
 * can be copied into kernels that cannot import the rendering bundle.
 */

export const A2UI_INPUT_MARKER = 'jupyterlite-a2ui-input:v1:';

export const A2UI_INPUT_LIMITS = Object.freeze({
  requestBytes: 262144,
  replyBytes: 65536,
  messages: 256,
  actions: 16,
  requestDepth: 32,
  replyDepth: 16,
});

const ACTION_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}(?![\s\S])/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}(?![\s\S])/;
const OPERATIONS = ['createSurface', 'updateComponents', 'updateDataModel'] as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

export type JsonObject = {[key: string]: JsonValue};

/** A validated A2UI input request. */
export interface A2uiInputRequest {
  messages: JsonObject[];
  prompt: string;
  submit: string[];
  cancel: string[];
}

export interface A2uiInputRequestOptions {
  /** Accessible label shown with the form. */
  prompt?: string;
  /** Action names that submit the form. Defaults to `['submit']`. */
  submit?: readonly string[];
  /** Action names that cancel the form. Defaults to `['cancel']`. */
  cancel?: readonly string[];
}

/** The submitted form: the ending action and the surface data model. */
export interface A2uiInputResult {
  action: string;
  context: JsonObject;
  data: JsonObject;
}

/** An A2UI input request or reply was invalid or could not be completed. */
export class A2uiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'A2uiInputError';
  }
}

/** The user cancelled the A2UI input form. */
export class A2uiInputCancelled extends A2uiInputError {
  constructor(message = 'A2UI input cancelled') {
    super(message);
    this.name = 'A2uiInputCancelled';
  }
}

export function utf8Size(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new A2uiInputError('Invalid Unicode');
      }
      bytes += 4;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new A2uiInputError('Invalid Unicode');
    } else {
      bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
    }
  }
  return bytes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  // Accept plain objects from other realms (iframes, vm contexts) too: their
  // prototype is that realm's Object.prototype, whose prototype is null.
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/**
 * Copy a value as plain JSON. Object properties that are `undefined` are
 * dropped, as `JSON.stringify` would; anything else that JSON cannot
 * represent exactly is rejected.
 */
export function copyJson(value: unknown, maxDepth: number, depth = 0): JsonValue {
  if (depth > maxDepth) {
    throw new A2uiInputError('Value is nested too deeply');
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    utf8Size(value);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new A2uiInputError('Unsupported number');
    }
    return value;
  }
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) {
        throw new A2uiInputError('Unsupported sparse array');
      }
      result.push(copyJson(value[i], maxDepth, depth + 1));
    }
    return result;
  }
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length) {
    throw new A2uiInputError('Unsupported value');
  }
  const result: JsonObject = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new A2uiInputError('Unsupported object property');
    }
    if (descriptor.value === undefined) {
      continue;
    }
    utf8Size(key);
    Object.defineProperty(result, key, {
      value: copyJson(descriptor.value, maxDepth, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

/** JSON.parse accepts duplicate keys, so check the valid JSON text for them. */
function rejectDuplicateKeys(text: string): void {
  const stack: Array<{keys: Set<string>; expectingKey: boolean} | null> = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      while (++i < text.length) {
        if (text[i] === '\\') {
          i++;
        } else if (text[i] === '"') {
          break;
        }
      }
      const object = stack[stack.length - 1];
      if (object?.expectingKey) {
        const key: string = JSON.parse(text.slice(start, i + 1));
        if (object.keys.has(key)) {
          throw new A2uiInputError('Duplicate JSON key');
        }
        object.keys.add(key);
        object.expectingKey = false;
      }
    } else if (char === '{') {
      stack.push({keys: new Set(), expectingKey: true});
    } else if (char === '[') {
      stack.push(null);
    } else if (char === '}' || char === ']') {
      stack.pop();
    } else if (char === ',') {
      const object = stack[stack.length - 1];
      if (object) {
        object.expectingKey = true;
      }
    }
  }
}

function parseJson(text: string, description: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new A2uiInputError(`Invalid JSON ${description}`);
    }
    throw error;
  }
  rejectDuplicateKeys(text);
  return value;
}

function validActionNames(names: unknown, min: number): names is string[] {
  return (
    Array.isArray(names) &&
    names.length >= min &&
    names.length <= A2UI_INPUT_LIMITS.actions &&
    names.every(name => typeof name === 'string' && ACTION_NAME.test(name)) &&
    new Set(names).size === names.length
  );
}

/**
 * Check the structure the input protocol depends on: one surface, created by
 * the first message and never deleted. Full A2UI schema validation is left to
 * the renderer.
 */
function validateMessages(messages: unknown): JsonObject[] {
  if (
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > A2UI_INPUT_LIMITS.messages
  ) {
    throw new A2uiInputError(
      `messages must be a list of 1 to ${A2UI_INPUT_LIMITS.messages} A2UI messages`,
    );
  }
  const copied = copyJson(messages, A2UI_INPUT_LIMITS.requestDepth) as JsonValue[];
  let surfaceId: string | undefined;
  copied.forEach((message, index) => {
    if (!isPlainObject(message) || message['version'] !== '1.0') {
      throw new A2uiInputError('Each message must be an A2UI v1.0 message object');
    }
    const keys = Object.keys(message);
    const operation = OPERATIONS.find(name => name in message);
    if (keys.length !== 2 || !operation) {
      throw new A2uiInputError(
        'Each message must contain one createSurface, updateComponents or updateDataModel operation',
      );
    }
    if ((operation === 'createSurface') !== (index === 0)) {
      throw new A2uiInputError('The first message, and only the first, must be createSurface');
    }
    const body = message[operation];
    const id = isPlainObject(body) ? body['surfaceId'] : undefined;
    if (typeof id !== 'string' || !id) {
      throw new A2uiInputError('Each message must name a surfaceId');
    }
    surfaceId ??= id;
    if (id !== surfaceId) {
      throw new A2uiInputError('All messages must target the created surface');
    }
  });
  return copied as JsonObject[];
}

function validateRequest(value: unknown): A2uiInputRequest {
  if (!isPlainObject(value)) {
    throw new A2uiInputError('Invalid request envelope');
  }
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'cancel,messages,prompt,submit') {
    throw new A2uiInputError('Invalid request envelope');
  }
  if (typeof value['prompt'] !== 'string') {
    throw new A2uiInputError('prompt must be a string');
  }
  utf8Size(value['prompt']);
  const submit = value['submit'];
  const cancel = value['cancel'];
  if (!validActionNames(submit, 1) || !validActionNames(cancel, 0)) {
    throw new A2uiInputError(
      `submit and cancel must list up to ${A2UI_INPUT_LIMITS.actions} unique, valid action names`,
    );
  }
  if (submit.some(name => cancel.includes(name))) {
    throw new A2uiInputError('An action cannot both submit and cancel');
  }
  return {
    messages: validateMessages(value['messages']),
    prompt: value['prompt'],
    submit: [...submit],
    cancel: [...cancel],
  };
}

/** Build a marked request for the frontend (kernel side). */
export function createA2uiInputRequest(
  messages: readonly unknown[],
  options: A2uiInputRequestOptions = {},
): string {
  const request = validateRequest({
    messages,
    prompt: options.prompt ?? '',
    submit: options.submit ? [...options.submit] : ['submit'],
    cancel: options.cancel ? [...options.cancel] : ['cancel'],
  });
  const text = A2UI_INPUT_MARKER + JSON.stringify(request);
  if (utf8Size(text) > A2UI_INPUT_LIMITS.requestBytes) {
    throw new A2uiInputError('Request is too large');
  }
  return text;
}

/**
 * Parse a marked request (frontend side). Unmarked prompts return undefined
 * so normal stdin can handle them; marked but malformed prompts throw.
 */
export function parseA2uiInputRequest(prompt: string): A2uiInputRequest | undefined {
  if (typeof prompt !== 'string' || !prompt.startsWith(A2UI_INPUT_MARKER)) {
    return undefined;
  }
  if (utf8Size(prompt) > A2UI_INPUT_LIMITS.requestBytes) {
    throw new A2uiInputError('Request is too large');
  }
  return validateRequest(parseJson(prompt.slice(A2UI_INPUT_MARKER.length), 'request'));
}

function validateResult(value: unknown): A2uiInputResult {
  if (!isPlainObject(value)) {
    throw new A2uiInputError('Invalid result');
  }
  const {action, context, data} = value;
  if (typeof action !== 'string' || !ACTION_NAME.test(action)) {
    throw new A2uiInputError('Invalid action name');
  }
  if (!isPlainObject(context) || !isPlainObject(data)) {
    throw new A2uiInputError('Action context and data must be objects');
  }
  return {
    action,
    context: copyJson(context, A2UI_INPUT_LIMITS.replyDepth - 1) as JsonObject,
    data: copyJson(data, A2UI_INPUT_LIMITS.replyDepth - 1) as JsonObject,
  };
}

/** Serialize a submitted form (frontend side). */
export function encodeA2uiInputResult(result: A2uiInputResult): string {
  const safe = validateResult(result);
  const reply = JSON.stringify({status: 'ok', ...safe});
  if (utf8Size(reply) > A2UI_INPUT_LIMITS.replyBytes) {
    throw new A2uiInputError('Reply is too large');
  }
  return reply;
}

/** Serialize a cancellation or a bounded, machine-readable error. */
export function encodeA2uiInputFailure(code?: string): string {
  if (code === undefined) {
    return '{"status":"cancelled"}';
  }
  if (!ERROR_CODE.test(code)) {
    throw new A2uiInputError('Invalid error code');
  }
  return `{"status":"error","code":"${code}"}`;
}

/**
 * Decode a reply (kernel side). Throws `A2uiInputCancelled` on cancellation
 * and `A2uiInputError` on errors or when the action is not a submit action.
 */
export function decodeA2uiInputReply(raw: string, submit: readonly string[]): A2uiInputResult {
  if (typeof raw !== 'string' || utf8Size(raw) > A2UI_INPUT_LIMITS.replyBytes) {
    throw new A2uiInputError('Invalid or oversized reply');
  }
  const reply = parseJson(raw, 'reply');
  if (!isPlainObject(reply)) {
    throw new A2uiInputError('Invalid reply envelope');
  }
  const keys = Object.keys(reply).sort().join(',');
  if (keys === 'status' && reply['status'] === 'cancelled') {
    throw new A2uiInputCancelled();
  }
  if (
    keys === 'code,status' &&
    reply['status'] === 'error' &&
    typeof reply['code'] === 'string' &&
    ERROR_CODE.test(reply['code'])
  ) {
    throw new A2uiInputError(`Frontend A2UI input error: ${reply['code']}`);
  }
  if (keys !== 'action,context,data,status' || reply['status'] !== 'ok') {
    throw new A2uiInputError('Invalid reply envelope');
  }
  const result = validateResult({
    action: reply['action'],
    context: reply['context'],
    data: reply['data'],
  });
  if (!submit.includes(result.action)) {
    throw new A2uiInputError('Reply action was not requested');
  }
  return result;
}
