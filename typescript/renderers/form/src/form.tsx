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

import React from 'react';
import {createRoot} from 'react-dom/client';
import {renderMarkdown} from '@a2ui/markdown-it';
import {A2uiSurface, MarkdownContext} from '@a2ui/react';
import {MessageProcessor} from '@a2ui/web_core';
import {AgentToRendererMessageSchema} from '@a2ui/web_core/v1_0';
import {basicCatalog, injectBasicCatalogStyles} from '@a2ui/web_core/catalogs/basic/v1';
import {injectStyles} from '@a2ui/react/styles';
import type {Catalog} from '@a2ui/web_core';
import type {ReactCatalogComponent} from '@a2ui/react';
import {A2uiInputError, copyJson, type JsonObject} from './protocol.js';

/** An action raised by a mounted form, with a snapshot of its data model. */
export interface A2uiFormAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  context: JsonObject;
  data: JsonObject;
}

/** How a mounted form ended. */
export type A2uiFormOutcome =
  | {status: 'submitted'; action: string; context: JsonObject; data: JsonObject}
  | {status: 'cancelled'; action?: string};

export interface MountA2uiFormOptions {
  /** Action names that end the form as submitted. */
  submit?: readonly string[];
  /** Action names that end the form as cancelled. */
  cancel?: readonly string[];
  /** Called for every action, including the ones that end the form. */
  onAction?: (action: A2uiFormAction) => void;
  /** Catalogs to render with. Defaults to the A2UI v1.0 basic catalog. */
  catalogs?: unknown[];
}

export interface A2uiFormHandle {
  /**
   * Settles when a submit or cancel action is raised, or `cancel()` is
   * called. Rejects with `A2uiInputError` if the messages cannot be rendered.
   */
  readonly result: Promise<A2uiFormOutcome>;
  /** Snapshot of the surface data model. */
  data(): JsonObject;
  /** End the form as cancelled, unless it has already ended. */
  cancel(): void;
  /** Unmount the form. Pending results are cancelled. */
  dispose(): void;
}

const MAX_DATA_DEPTH = 15;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as {message: unknown}).message);
  }
  return String(error);
}

/**
 * Render one A2UI surface from `messages` into `element`. The messages must
 * create exactly one surface; it is the form whose data model is returned.
 */
export function mountA2uiForm(
  element: HTMLElement,
  messages: readonly unknown[],
  options: MountA2uiFormOptions = {},
): A2uiFormHandle {
  const submit = new Set(options.submit ?? []);
  const cancel = new Set(options.cancel ?? []);
  let settle!: (outcome: A2uiFormOutcome) => void;
  let fail!: (error: Error) => void;
  const result = new Promise<A2uiFormOutcome>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  let settled = false;
  let disposed = false;
  let surfaceId: string | undefined;

  const status = document.createElement('div');
  status.className = 'a2ui-form-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const app = document.createElement('div');
  app.className = 'a2ui-form-surface';
  element.replaceChildren(status, app);

  const end = (outcome: A2uiFormOutcome) => {
    if (!settled) {
      settled = true;
      settle(outcome);
    }
  };
  const abort = (error: unknown) => {
    const message = describeError(error);
    status.textContent = `A2UI form error: ${message}`;
    if (!settled) {
      settled = true;
      fail(error instanceof A2uiInputError ? error : new A2uiInputError(message));
    }
  };

  const reactCatalogs = (options.catalogs ?? [basicCatalog]) as Catalog<ReactCatalogComponent>[];
  const processor = new MessageProcessor<ReactCatalogComponent>(reactCatalogs, undefined, {
    version: '1.0',
    reportErrorsOnly: true,
  });

  const data = (): JsonObject => {
    const surface = surfaceId ? processor.model.getSurface(surfaceId) : undefined;
    const value: unknown = surface?.dataModel.get('/') ?? {};
    const copy = copyJson(value, MAX_DATA_DEPTH);
    if (copy === null || typeof copy !== 'object' || Array.isArray(copy)) {
      throw new A2uiInputError('The surface data model must be an object');
    }
    return copy;
  };

  const actionSub = processor.model.onAction.subscribe(action => {
    if (settled || disposed || action.surfaceId !== surfaceId) {
      return;
    }
    let snapshot: A2uiFormAction;
    try {
      snapshot = {
        name: action.name,
        surfaceId: action.surfaceId,
        sourceComponentId: action.sourceComponentId,
        context: copyJson(action.context ?? {}, MAX_DATA_DEPTH) as JsonObject,
        data: data(),
      };
    } catch (error) {
      abort(error);
      return;
    }
    try {
      options.onAction?.(snapshot);
    } catch (error) {
      console.error('A2UI form action handler failed:', error);
    }
    if (submit.has(snapshot.name)) {
      end({
        status: 'submitted',
        action: snapshot.name,
        context: snapshot.context,
        data: snapshot.data,
      });
    } else if (cancel.has(snapshot.name)) {
      end({status: 'cancelled', action: snapshot.name});
    }
  });
  let initializing = true;
  const errorSub = processor.model.onError.subscribe(error => {
    if (initializing) {
      abort(error);
    } else {
      status.textContent = `A2UI form error: ${describeError(error)}`;
    }
  });

  injectBasicCatalogStyles();
  injectStyles();
  const root = createRoot(app);

  void (async () => {
    const parsed = [];
    for (const message of messages) {
      const checked = AgentToRendererMessageSchema.safeParse(message);
      if (!checked.success) {
        throw new A2uiInputError(`Invalid A2UI message: ${describeError(checked.error)}`);
      }
      parsed.push(checked.data);
    }
    const created = parsed.filter(message => 'createSurface' in message);
    if (created.length !== 1 || !('createSurface' in created[0]!)) {
      throw new A2uiInputError('The messages must create exactly one surface');
    }
    surfaceId = created[0].createSurface.surfaceId;
    await processor.processMessagesAsync(parsed);
    const surface = processor.model.getSurface(surfaceId);
    if (!surface) {
      throw new A2uiInputError('The surface was not created');
    }
    if (!settled && !disposed) {
      root.render(
        <MarkdownContext.Provider value={renderMarkdown}>
          <A2uiSurface surface={surface} />
        </MarkdownContext.Provider>,
      );
    }
  })()
    .catch(abort)
    .finally(() => {
      initializing = false;
    });

  return {
    result,
    data,
    cancel: () => end({status: 'cancelled'}),
    dispose: () => {
      if (disposed) {
        return;
      }
      end({status: 'cancelled'});
      disposed = true;
      actionSub.unsubscribe();
      errorSub.unsubscribe();
      root.unmount();
      processor.dispose();
      element.replaceChildren();
    },
  };
}
