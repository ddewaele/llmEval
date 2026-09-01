import { EventEmitter } from "node:events";

/**
 * Tracks in-process background jobs (runs, generation, rescoring): one AbortController per job
 * and a shared event bus. State lives in SQLite; this only holds what cannot be persisted.
 */
export class JobRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly tasks = new Map<string, Promise<void>>();
  readonly events = new EventEmitter({ captureRejections: false });

  constructor() {
    this.events.setMaxListeners(0);
  }

  isActive(id: string): boolean {
    return this.controllers.has(id);
  }

  /** Start a job; the task receives the abort signal and must resolve when finished or aborted. */
  start(id: string, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.controllers.has(id)) return this.tasks.get(id)!;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const promise = task(controller.signal).finally(() => {
      this.controllers.delete(id);
      this.tasks.delete(id);
    });
    this.tasks.set(id, promise);
    return promise;
  }

  cancel(id: string): boolean {
    const c = this.controllers.get(id);
    if (!c) return false;
    c.abort(new Error("cancelled"));
    return true;
  }

  /** Resolves when the job has finished (immediately if it is not active). */
  async wait(id: string): Promise<void> {
    await this.tasks.get(id);
  }

  emit(channel: string, payload: unknown): void {
    this.events.emit(channel, payload);
  }

  subscribe(channel: string, listener: (payload: unknown) => void): () => void {
    this.events.on(channel, listener);
    return () => this.events.off(channel, listener);
  }
}
