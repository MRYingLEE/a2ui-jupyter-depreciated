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

import {AgentToRendererMessageSchema, RendererToAgentMessageSchema} from '@a2ui/web_core/v1_0';
import type {
  ActionMessage,
  AgentToRendererMessage,
  RendererToAgentMessage,
} from '@a2ui/web_core/v1_0';

const LOG_SYNC_DELAY_MS = 200;

interface IssueLike {
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly unionErrors?: readonly {readonly issues: readonly IssueLike[]}[];
}

/**
 * Shape of the kernel `Widget` base class exposed as `Jupyter.widgets.Widget`.
 * Only the members this adapter relies on are declared.
 */
interface KernelWidgetBase {
  _comm: {send(data: Record<string, unknown>): void};
  _handleMsg(data: Record<string, unknown>, buffers?: unknown[]): void;
  get(name: string): unknown;
  set(name: string, value: unknown): void;
}

type KernelWidgetBaseConstructor = new (state?: Record<string, unknown>) => KernelWidgetBase;

type LogEntry = {sequence: number; message: AgentToRendererMessage};
export type MessageHandler = (message: RendererToAgentMessage) => void;
export type ActionHandler = (message: ActionMessage) => void;

const kernelWidgetBase = (globalThis as {Jupyter?: {widgets?: {Widget?: unknown}}}).Jupyter?.widgets
  ?.Widget;
if (typeof kernelWidgetBase !== 'function') {
  throw new Error(
    'The A2UI kernel adapter must be loaded in a JavaScript kernel cell, where Jupyter.widgets.Widget is available.',
  );
}
const WidgetBaseClass = kernelWidgetBase as unknown as KernelWidgetBaseConstructor;

/**
 * A2UI surface for the JavaScript kernel. It mirrors the Python `A2UISurface`:
 * `send` queues agent messages for the browser, while browser messages are
 * dispatched to handlers and kept in queues for later cells to take.
 */
export class A2UISurface extends WidgetBaseClass {
  static modelName = 'AnyModel';
  static modelModule = 'anywidget';
  static modelModuleVersion = '~0.11.*';
  static viewName = 'AnyView';
  static viewModule = 'anywidget';
  static viewModuleVersion = '~0.11.*';

  private readonly log: LogEntry[] = [];
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly actionHandlers = new Set<ActionHandler>();
  private readonly messageQueue: RendererToAgentMessage[] = [];
  private readonly actionQueue: ActionMessage[] = [];
  private syncedCount = 0;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super({
      _esm: new URL('./widget.js', import.meta.url).href,
      _css: new URL('./widget.css', import.meta.url).href,
      message_log: [],
    });
  }

  /**
   * Queues one or more agent messages for the browser. The whole batch is
   * validated before anything is sent.
   */
  send(messages: AgentToRendererMessage | AgentToRendererMessage[]): void {
    const batch = Array.isArray(messages) ? messages : [messages];
    const snapshots = batch.map(message => {
      const result = AgentToRendererMessageSchema.safeParse(message);
      if (!result.success) {
        throw new Error(`Invalid A2UI message: ${describeIssues(result.error.issues)}`);
      }
      return structuredClone(result.data);
    });
    for (const message of snapshots) {
      const sequence = this.log.length;
      this.log.push({sequence, message});
      this._comm.send({
        method: 'custom',
        content: {type: 'a2ui', sequence, message},
      });
    }
    this.scheduleLogSync();
  }

  /** Registers a handler for every browser message. Returns an unsubscribe function. */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /** Registers a handler for browser action messages. Returns an unsubscribe function. */
  onAction(handler: ActionHandler): () => void {
    this.actionHandlers.add(handler);
    return () => {
      this.actionHandlers.delete(handler);
    };
  }

  /** Removes and returns the oldest queued browser message, or `undefined` if none. */
  takeMessage(): RendererToAgentMessage | undefined {
    return this.messageQueue.shift();
  }

  /** Removes and returns the oldest queued browser action, or `undefined` if none. */
  takeAction(): ActionMessage | undefined {
    return this.actionQueue.shift();
  }

  override _handleMsg(data: Record<string, unknown>, buffers?: unknown[]): void {
    if (data.method === 'custom') {
      this.handleCustomMessage(data.content);
      return;
    }
    if (data.method === 'request_state') {
      this.syncLog();
    }
    super._handleMsg(data, buffers);
  }

  private handleCustomMessage(content: unknown): void {
    if (!isRecord(content) || content.type !== 'a2ui') {
      return;
    }
    const result = RendererToAgentMessageSchema.safeParse(content.message);
    if (!result.success) {
      console.error(
        `Ignoring invalid A2UI message from the browser: ${describeIssues(result.error.issues)}`,
      );
      return;
    }
    const message = result.data;
    this.messageQueue.push(message);
    dispatch(this.messageHandlers, message);
    if ('action' in message) {
      this.actionQueue.push(message);
      dispatch(this.actionHandlers, message);
    }
  }

  private scheduleLogSync(): void {
    if (this.syncTimer !== undefined) {
      return;
    }
    this.syncTimer = setTimeout(() => this.syncLog(), LOG_SYNC_DELAY_MS);
  }

  /** Publishes the full log as `message_log`, so the browser can replay it on reopen. */
  private syncLog(): void {
    if (this.syncTimer !== undefined) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }
    if (this.syncedCount === this.log.length) {
      return;
    }
    this.set('message_log', [...this.log]);
    this.syncedCount = this.log.length;
  }
}

function dispatch<T>(handlers: Set<(value: T) => void>, value: T): void {
  for (const handler of [...handlers]) {
    try {
      handler(value);
    } catch (error) {
      console.error('A2UI handler failed:', error);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Flattens Zod issues, including the nested errors of union failures. */
function describeIssues(issues: readonly IssueLike[]): string {
  return issues
    .flatMap(issue =>
      issue.unionErrors?.length
        ? issue.unionErrors.flatMap(error => describeIssues(error.issues))
        : [`${issue.path.join('.') || '(root)'}: ${issue.message}`],
    )
    .join('; ');
}
