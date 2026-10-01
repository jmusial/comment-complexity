import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Debouncer } from "../../debounce";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Debouncer", () => {
  it("runs the latest work once calls pause, per key", () => {
    const debouncer = new Debouncer(300);
    const work = vi.fn<(name: string) => void>();
    debouncer.schedule("a", () => work("a1"));
    vi.advanceTimersByTime(200);
    debouncer.schedule("a", () => work("a2"));
    debouncer.schedule("b", () => work("b"));
    vi.advanceTimersByTime(299);
    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(work.mock.calls).toEqual([["a2"], ["b"]]);
  });

  it("drops cancelled and disposed work", () => {
    const debouncer = new Debouncer(300);
    const work = vi.fn<() => void>();
    debouncer.schedule("a", work);
    debouncer.cancel("a");
    debouncer.cancel("never scheduled");
    debouncer.schedule("b", work);
    debouncer.schedule("c", work);
    debouncer.dispose();
    vi.advanceTimersByTime(1_000);
    expect(work).not.toHaveBeenCalled();
  });
});
