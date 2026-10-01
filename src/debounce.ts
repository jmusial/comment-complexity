/** Runs work per key only once its calls have paused for `delay` ms, as when typing stops. */
export class Debouncer {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly delay: number) {}

  /** Runs `work` after `delay` ms, replacing work still waiting under the same key. */
  schedule(key: string, work: () => void): void {
    this.cancel(key);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        work();
      }, this.delay),
    );
  }

  cancel(key: string): void {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
