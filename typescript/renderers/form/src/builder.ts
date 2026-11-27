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
 * A small form builder that turns a list of field specifications into one
 * A2UI v1.0 `createSurface` message for the basic catalog. The Python, R and
 * JavaScript kernel helpers implement the same mapping; the shared fixture in
 * `tests/fixtures/form-builder.json` pins it.
 */

import {
  A2uiInputError,
  createA2uiInputRequest,
  decodeA2uiInputReply,
  type JsonObject,
  type JsonValue,
} from './protocol.js';

export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';

export const FIELD_TYPES = [
  'text',
  'longText',
  'password',
  'number',
  'checkbox',
  'choice',
  'multiChoice',
  'slider',
  'date',
  'time',
  'datetime',
] as const;

export type A2uiFieldType = (typeof FIELD_TYPES)[number];

export interface A2uiChoiceOption {
  label: string;
  value: string;
}

export interface A2uiFormField {
  name: string;
  type?: A2uiFieldType;
  label?: string;
  value?: JsonValue;
  placeholder?: string;
  options?: Array<string | A2uiChoiceOption>;
  min?: number;
  max?: number;
  steps?: number;
  required?: boolean;
}

export interface A2uiFormOptions {
  title?: string;
  surfaceId?: string;
  submitLabel?: string;
  /** Label of the cancel button; `null` leaves the button out. */
  cancelLabel?: string | null;
  submitAction?: string;
  cancelAction?: string;
}

export interface A2uiFormInputOptions extends A2uiFormOptions {
  /** Accessible label shown with the form. */
  prompt?: string;
}

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}(?![\s\S])/;
// The same decimal syntax is accepted by the Python and R helpers.
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const TEXT_VARIANTS: Partial<Record<A2uiFieldType, string>> = {
  text: 'shortText',
  longText: 'longText',
  password: 'obscured',
  number: 'number',
};

function fail(message: string): never {
  throw new A2uiInputError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, description: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${description} must be a finite number`);
  }
  return value;
}

function normalizeOptions(field: A2uiFormField): A2uiChoiceOption[] {
  if (!Array.isArray(field.options) || field.options.length === 0) {
    fail(`Field "${field.name}" needs a non-empty options list`);
  }
  const options = field.options.map(option => {
    if (typeof option === 'string') {
      return {label: option, value: option};
    }
    if (isRecord(option) && typeof option.label === 'string' && typeof option.value === 'string') {
      return {label: option.label, value: option.value};
    }
    return fail(`Field "${field.name}" has an invalid option`);
  });
  if (new Set(options.map(option => option.value)).size !== options.length) {
    fail(`Field "${field.name}" has duplicate option values`);
  }
  return options;
}

function defaultValue(field: A2uiFormField, type: A2uiFieldType): JsonValue {
  const value = field.value;
  switch (type) {
    case 'checkbox':
      if (value === undefined) return false;
      if (typeof value !== 'boolean') fail(`Field "${field.name}" value must be a boolean`);
      return value;
    case 'choice':
    case 'multiChoice': {
      if (value === undefined || value === null) return [];
      const list = typeof value === 'string' ? [value] : value;
      if (!Array.isArray(list) || !list.every(item => typeof item === 'string')) {
        fail(`Field "${field.name}" value must be a string or a list of strings`);
      }
      return list;
    }
    case 'slider':
      if (value === undefined) return field.min ?? 0;
      return finite(value, `Field "${field.name}" value`);
    case 'number':
      if (value === undefined || value === null) return '';
      if (typeof value === 'number') return String(finite(value, `Field "${field.name}" value`));
      if (typeof value !== 'string') fail(`Field "${field.name}" value must be a number or string`);
      return value;
    default:
      if (value === undefined || value === null) return '';
      if (typeof value !== 'string') fail(`Field "${field.name}" value must be a string`);
      return value;
  }
}

function requiredCheck(name: string): JsonObject {
  return {'@call': 'required', 'args': {'value': {'@path': `/${name}`}}};
}

function fieldComponent(field: A2uiFormField, type: A2uiFieldType, label: string): JsonObject {
  const id = `field_${field.name}`;
  const value = {'@path': `/${field.name}`};
  const textVariant = TEXT_VARIANTS[type];
  if (textVariant) {
    const component: JsonObject = {id, component: 'TextField', label, value, variant: textVariant};
    if (field.placeholder !== undefined) {
      if (typeof field.placeholder !== 'string') {
        fail(`Field "${field.name}" placeholder must be a string`);
      }
      component['placeholder'] = field.placeholder;
    }
    return component;
  }
  switch (type) {
    case 'checkbox':
      return {id, component: 'CheckBox', label, value};
    case 'choice':
    case 'multiChoice':
      return {
        id,
        component: 'ChoicePicker',
        label,
        variant: type === 'choice' ? 'mutuallyExclusive' : 'multipleSelection',
        options: normalizeOptions(field) as unknown as JsonValue[],
        value,
      };
    case 'slider': {
      const component: JsonObject = {
        id,
        component: 'Slider',
        label,
        min: field.min === undefined ? 0 : finite(field.min, `Field "${field.name}" min`),
        max: finite(field.max, `Field "${field.name}" max`),
        value,
      };
      if (field.steps !== undefined) {
        if (!Number.isSafeInteger(field.steps) || field.steps < 1) {
          fail(`Field "${field.name}" steps must be a positive integer`);
        }
        component['steps'] = field.steps;
      }
      return component;
    }
    default:
      return {
        id,
        component: 'DateTimeInput',
        label,
        value,
        enableDate: type !== 'time',
        enableTime: type !== 'date',
      };
  }
}

/** Build an A2UI v1.0 message list for a simple form. */
export function a2uiForm(
  fields: readonly A2uiFormField[],
  options: A2uiFormOptions = {},
): JsonObject[] {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 64) {
    fail('fields must be a list of 1 to 64 field specifications');
  }
  const {
    title,
    surfaceId = 'a2ui-form',
    submitLabel = 'Submit',
    cancelLabel = 'Cancel',
    submitAction = 'submit',
    cancelAction = 'cancel',
  } = options;
  for (const [name, value] of Object.entries({surfaceId, submitLabel, submitAction})) {
    if (typeof value !== 'string' || !value) fail(`${name} must be a non-empty string`);
  }
  if (title !== undefined && typeof title !== 'string') fail('title must be a string');
  if (cancelLabel !== null && (typeof cancelLabel !== 'string' || !cancelLabel)) {
    fail('cancelLabel must be a non-empty string or null');
  }
  if (cancelLabel !== null && (typeof cancelAction !== 'string' || !cancelAction)) {
    fail('cancelAction must be a non-empty string');
  }

  const names = new Set<string>();
  const dataModel: JsonObject = {};
  const fieldComponents: JsonObject[] = [];
  const required: string[] = [];
  for (const field of fields as readonly unknown[] as A2uiFormField[]) {
    if (
      !isRecord(field as unknown) ||
      typeof field.name !== 'string' ||
      !FIELD_NAME.test(field.name)
    ) {
      fail('Each field needs a name of letters, digits and underscores starting with a letter');
    }
    if (names.has(field.name)) fail(`Duplicate field name "${field.name}"`);
    names.add(field.name);
    const type = field.type ?? 'text';
    if (!(FIELD_TYPES as readonly string[]).includes(type)) {
      fail(`Field "${field.name}" has unknown type "${String(type)}"`);
    }
    const label = field.label ?? field.name;
    if (typeof label !== 'string') fail(`Field "${field.name}" label must be a string`);
    dataModel[field.name] = defaultValue(field, type);
    const component = fieldComponent(field, type, label);
    if (field.required) {
      component['@checks'] = [
        {condition: requiredCheck(field.name), message: `${label} is required`},
      ];
      required.push(field.name);
    }
    fieldComponents.push(component);
  }

  const submit: JsonObject = {
    id: 'form_submit',
    component: 'Button',
    child: 'form_submit_label',
    variant: 'primary',
    action: {event: {name: submitAction}},
  };
  if (required.length) {
    submit['@checks'] = [
      {
        condition:
          required.length === 1
            ? requiredCheck(required[0]!)
            : {'@call': 'and', 'args': {'values': required.map(requiredCheck)}},
        message: 'Complete the required fields',
      },
    ];
  }
  const buttons: JsonObject[] = [];
  const buttonIds: string[] = [];
  if (cancelLabel !== null) {
    buttonIds.push('form_cancel');
    buttons.push(
      {
        id: 'form_cancel',
        component: 'Button',
        child: 'form_cancel_label',
        action: {event: {name: cancelAction}},
      },
      {id: 'form_cancel_label', component: 'Text', text: cancelLabel},
    );
  }
  buttonIds.push('form_submit');
  buttons.push(submit, {id: 'form_submit_label', component: 'Text', text: submitLabel});

  const children: string[] = [];
  const components: JsonObject[] = [
    {id: 'root', component: 'Card', child: 'form_column'},
    {id: 'form_column', component: 'Column', children},
  ];
  if (title !== undefined) {
    children.push('form_title');
    components.push({id: 'form_title', component: 'Text', text: `### ${title}`});
  }
  children.push(...fieldComponents.map(component => component['id'] as string), 'form_actions');
  components.push(...fieldComponents, {
    id: 'form_actions',
    component: 'Row',
    justify: 'end',
    children: buttonIds,
  });
  components.push(...buttons);

  return [
    {
      version: '1.0',
      createSurface: {surfaceId, catalogId: BASIC_CATALOG_ID, components, dataModel},
    },
  ];
}

/**
 * Convert `number` fields, which A2UI text fields store as strings, to numbers.
 * Empty values become `null`; text that is not a number raises an error.
 */
export function coerceA2uiFormData(fields: readonly A2uiFormField[], data: JsonObject): JsonObject {
  const result: JsonObject = {...data};
  for (const field of fields) {
    if (field.type !== 'number' || !(field.name in result)) continue;
    const value = result[field.name];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text) {
      result[field.name] = null;
      continue;
    }
    const number = Number(text);
    if (!DECIMAL.test(text) || !Number.isFinite(number)) {
      fail(`Field "${field.name}" is not a number`);
    }
    result[field.name] = number;
  }
  return result;
}

/** Build the marked stdin prompt that shows `a2uiForm(fields, options)`. */
export function createA2uiFormInputRequest(
  fields: readonly A2uiFormField[],
  options: A2uiFormInputOptions = {},
): string {
  const {prompt, ...form} = options;
  return createA2uiInputRequest(a2uiForm(fields, form), {
    prompt,
    submit: [form.submitAction ?? 'submit'],
    cancel: form.cancelLabel === null ? [] : [form.cancelAction ?? 'cancel'],
  });
}

/** Decode the reply to `createA2uiFormInputRequest` into coerced form data. */
export function decodeA2uiFormInputReply(
  fields: readonly A2uiFormField[],
  raw: string,
  options: A2uiFormInputOptions = {},
): JsonObject {
  const result = decodeA2uiInputReply(raw, [options.submitAction ?? 'submit']);
  return coerceA2uiFormData(fields, result.data);
}
