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

import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {renderMarkdown} from '@a2ui/markdown-it';
import {A2uiSurface, MarkdownContext} from '@a2ui/react';
import {MessageProcessor} from '@a2ui/web_core';
import {AgentToRendererMessageSchema, RendererToAgentMessageSchema} from '@a2ui/web_core/v1_0';
import {basicCatalog, injectBasicCatalogStyles} from '@a2ui/web_core/catalogs/basic/v1';
import {injectStyles} from '@a2ui/react/styles';
import type {Catalog, ComponentApi, FunctionImplementation} from '@a2ui/web_core';
import type {ReactCatalogComponent} from '@a2ui/react';
import './widget.css';

interface WidgetModel {
  get(name: string): unknown;
  on(eventName: string, handler: (content: unknown) => void): void;
  off(eventName: string, handler: (content: unknown) => void): void;
  send(content: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error['message'] === 'string') {
    return error['message'];
  }
  return String(error);
}

const MOUNT_KEY = Symbol.for('@a2ui/jupyter/mountA2uiWidget');

interface SurfaceVisibility {
  getSnapshot: () => ReadonlySet<string>;
  subscribe: (listener: () => void) => () => void;
  hide: (surfaceId: string) => void;
  show: (surfaceId: string) => void;
}

function createSurfaceVisibility(): SurfaceVisibility {
  let hiddenSurfaceIds = new Set<string>();
  const listeners = new Set<() => void>();
  const update = (surfaceId: string, hidden: boolean) => {
    if (hiddenSurfaceIds.has(surfaceId) === hidden) {
      return;
    }
    hiddenSurfaceIds = new Set(hiddenSurfaceIds);
    if (hidden) {
      hiddenSurfaceIds.add(surfaceId);
    } else {
      hiddenSurfaceIds.delete(surfaceId);
    }
    listeners.forEach(listener => listener());
  };

  return {
    getSnapshot: () => hiddenSurfaceIds,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hide: surfaceId => update(surfaceId, true),
    show: surfaceId => update(surfaceId, false),
  };
}

function SurfaceList({
  processor,
  visibility,
}: {
  processor: MessageProcessor<ReactCatalogComponent>;
  visibility: SurfaceVisibility;
}) {
  const [surfaces, setSurfaces] = useState(() => Array.from(processor.model.surfacesMap.entries()));
  const hiddenSurfaceIds = useSyncExternalStore(
    visibility.subscribe,
    visibility.getSnapshot,
    visibility.getSnapshot,
  );

  useEffect(() => {
    const refresh = () => setSurfaces(Array.from(processor.model.surfacesMap.entries()));
    const created = processor.model.onSurfaceCreated.subscribe(refresh);
    const deleted = processor.model.onSurfaceDeleted.subscribe(refresh);
    refresh();
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, [processor]);

  return (
    <div className="a2ui-widget-surfaces">
      {surfaces.map(
        ([surfaceId, surface]) =>
          !hiddenSurfaceIds.has(surfaceId) && (
            <section
              aria-label={`A2UI surface ${surfaceId}`}
              className="a2ui-widget-surface"
              key={surfaceId}
            >
              <A2uiSurface surface={surface} />
            </section>
          ),
      )}
    </div>
  );
}

export function mountA2uiWidget(
  model: WidgetModel,
  element: HTMLElement,
  catalogs: Catalog<ComponentApi, FunctionImplementation>[] = [basicCatalog],
): () => void {
  const visibility = createSurfaceVisibility();
  const status = document.createElement('div');
  status.className = 'a2ui-widget-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const app = document.createElement('div');
  element.replaceChildren(status, app);

  const showError = (error: unknown) => {
    const message = `A2UI renderer error: ${describeError(error)}`;
    status.textContent = message;
    console.error(message);
  };
  const sendToKernel = (message: unknown) => {
    const result = RendererToAgentMessageSchema.safeParse(message);
    if (!result.success) {
      showError(result.error);
      return;
    }
    model.send({type: 'a2ui', message: result.data});
    if ('action' in result.data && result.data.action.name.toLowerCase().includes('submit')) {
      visibility.hide(result.data.action.surfaceId);
    }
  };

  // The React renderer wraps catalog implementations before resolving nodes.
  const reactCatalogs = catalogs as unknown as Catalog<ReactCatalogComponent>[];
  const processor = new MessageProcessor<ReactCatalogComponent>(reactCatalogs, undefined, {
    version: '1.0',
    unifiedOutbound: true,
    outboundListener: sendToKernel,
    reportErrorsOnly: true,
  });
  const errorSub = processor.model.onError.subscribe(showError);
  const root = createRoot(app);
  root.render(
    <MarkdownContext.Provider value={renderMarkdown}>
      <SurfaceList processor={processor} visibility={visibility} />
    </MarkdownContext.Provider>,
  );
  injectBasicCatalogStyles();
  injectStyles();

  let nextSequence = 0;
  let processing = Promise.resolve();
  const queued = new Map<number, unknown>();

  const acceptEntry = (sequence: unknown, message: unknown) => {
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
      showError(new Error('Invalid message log sequence.'));
      return;
    }
    if (sequence < nextSequence || queued.has(sequence)) {
      return;
    }
    queued.set(sequence, message);
    while (queued.has(nextSequence)) {
      const nextMessage = queued.get(nextSequence);
      queued.delete(nextSequence);
      nextSequence += 1;
      processing = processing.then(async () => {
        const result = AgentToRendererMessageSchema.safeParse(nextMessage);
        if (!result.success) {
          showError(result.error);
          return;
        }
        await processor.processMessagesAsync([result.data]);
        if ('createSurface' in result.data) {
          visibility.show(result.data.createSurface.surfaceId);
        } else if ('updateComponents' in result.data) {
          visibility.show(result.data.updateComponents.surfaceId);
        }
      });
      processing = processing.catch(showError);
    }
  };

  // The log can sync after this view mounts, and custom messages sent before
  // mounting never reach this view. Re-reading the log on change recovers both.
  const replayMessageLog = () => {
    const replay = model.get('message_log');
    if (!Array.isArray(replay)) {
      return;
    }
    for (const item of replay) {
      if (!isRecord(item)) {
        showError(new Error('Invalid message log entry.'));
        continue;
      }
      acceptEntry(item['sequence'], item['message']);
    }
  };
  replayMessageLog();

  const onCustomMessage = (content: unknown) => {
    if (!isRecord(content) || content['type'] !== 'a2ui') {
      showError(new Error("Unsupported custom message; expected type 'a2ui'."));
      return;
    }
    acceptEntry(content['sequence'], content['message']);
  };
  model.on('change:message_log', replayMessageLog);
  model.on('msg:custom', onCustomMessage);

  return () => {
    model.off('change:message_log', replayMessageLog);
    model.off('msg:custom', onCustomMessage);
    errorSub.unsubscribe();
    root.unmount();
    processor.dispose();
    element.replaceChildren();
  };
}

export default {
  render({model, el}: {model: WidgetModel; el: HTMLElement}) {
    // anywidget evaluates this module again for each cell. Each evaluation has its own copy of
    // web_core, and its element classes only accept nodes from that copy (they check with
    // `instanceof`). Mounting every view through the first evaluation keeps one runtime per page.
    const mount = ((globalThis as Record<symbol, unknown>)[MOUNT_KEY] ??=
      mountA2uiWidget) as typeof mountA2uiWidget;
    return mount(model, el);
  },
};
