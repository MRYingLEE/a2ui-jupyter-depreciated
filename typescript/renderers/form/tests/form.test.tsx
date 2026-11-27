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

import {fireEvent, waitFor, within} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {A2uiInputError, a2uiForm, mountA2uiForm} from '../src/index';

function mount(messages: unknown[], options = {}) {
  const element = document.createElement('div');
  document.body.append(element);
  return {element, handle: mountA2uiForm(element, messages, options)};
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('mountA2uiForm', () => {
  it('resolves with the data model when a submit action is raised', async () => {
    const onAction = vi.fn();
    const {element, handle} = mount(
      a2uiForm([{name: 'answer', label: 'Answer', value: 'forty-two'}]),
      {submit: ['submit'], cancel: ['cancel'], onAction},
    );
    const submit = await waitFor(() => within(element).getByRole('button', {name: 'Submit'}));
    fireEvent.click(submit);

    await expect(handle.result).resolves.toEqual({
      status: 'submitted',
      action: 'submit',
      context: {},
      data: {answer: 'forty-two'},
    });
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({name: 'submit', surfaceId: 'a2ui-form'}),
    );
    handle.dispose();
    expect(element).toBeEmptyDOMElement();
  });

  it('ends as cancelled on a cancel action', async () => {
    const {element, handle} = mount(a2uiForm([{name: 'answer'}]), {
      submit: ['submit'],
      cancel: ['cancel'],
    });
    fireEvent.click(await waitFor(() => within(element).getByRole('button', {name: 'Cancel'})));
    await expect(handle.result).resolves.toEqual({status: 'cancelled', action: 'cancel'});
    handle.dispose();
  });

  it('reports other actions without ending the form', async () => {
    const onAction = vi.fn();
    const {element, handle} = mount(
      a2uiForm([{name: 'answer'}], {submitAction: 'preview', cancelLabel: null}),
      {submit: ['submit'], onAction},
    );
    fireEvent.click(await waitFor(() => within(element).getByRole('button', {name: 'Submit'})));
    await waitFor(() => expect(onAction).toHaveBeenCalled());
    handle.cancel();
    await expect(handle.result).resolves.toEqual({status: 'cancelled'});
    handle.dispose();
  });

  it('keeps submit disabled until required fields are filled', async () => {
    const {element, handle} = mount(a2uiForm([{name: 'name', required: true}]), {
      submit: ['submit'],
    });
    const submit = () => within(element).getByRole('button', {name: 'Submit'});
    await waitFor(() => expect(submit()).toHaveProperty('disabled', true));
    fireEvent.input(within(element).getByRole('textbox'), {target: {value: 'Ada'}});
    await waitFor(() => expect(submit()).toHaveProperty('disabled', false));
    fireEvent.click(submit());
    await expect(handle.result).resolves.toMatchObject({data: {name: 'Ada'}});
  });

  it('rejects messages that do not render', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {element, handle} = mount([{version: '1.0', createSurface: {surfaceId: 's'}}, {}]);
    await expect(handle.result).rejects.toBeInstanceOf(A2uiInputError);
    expect(within(element).getByRole('status')).toHaveTextContent('A2UI form error');
    handle.dispose();
  });
});
