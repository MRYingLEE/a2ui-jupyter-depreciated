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

export {
  A2UI_INPUT_LIMITS,
  A2UI_INPUT_MARKER,
  A2uiInputCancelled,
  A2uiInputError,
  copyJson,
  createA2uiInputRequest,
  decodeA2uiInputReply,
  encodeA2uiInputFailure,
  encodeA2uiInputResult,
  parseA2uiInputRequest,
  utf8Size,
  type A2uiInputRequest,
  type A2uiInputRequestOptions,
  type A2uiInputResult,
  type JsonObject,
  type JsonValue,
} from './protocol.js';
export {
  BASIC_CATALOG_ID,
  FIELD_TYPES,
  a2uiForm,
  coerceA2uiFormData,
  createA2uiFormInputRequest,
  decodeA2uiFormInputReply,
  type A2uiChoiceOption,
  type A2uiFieldType,
  type A2uiFormField,
  type A2uiFormInputOptions,
  type A2uiFormOptions,
} from './builder.js';
export {
  mountA2uiForm,
  type A2uiFormAction,
  type A2uiFormHandle,
  type A2uiFormOutcome,
  type MountA2uiFormOptions,
} from './form.js';
