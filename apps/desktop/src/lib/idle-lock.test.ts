import { afterEach, expect, it, vi } from "vitest";
import { idleLockMs, watchIdle } from "./idle-lock";

afterEach(() => vi.useRealTimers());

it("locks at 15 minutes since the last input, once per active screen", () => {
  vi.useFakeTimers();
  const events = new EventTarget();
  const document = new EventTarget();
  const lock = vi.fn();
  const stop = watchIdle(lock, events, document);
  vi.advanceTimersByTime(60_000);
  events.dispatchEvent(new Event("keydown"));
  vi.advanceTimersByTime(idleLockMs - 1);
  expect(lock).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(lock).toHaveBeenCalledTimes(1);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("locks before accepting new input if the wall clock advanced during sleep", () => {
  vi.useFakeTimers();
  const events = new EventTarget();
  const lock = vi.fn();
  const stop = watchIdle(lock, events, new EventTarget());
  vi.setSystemTime(Date.now() + idleLockMs);
  events.dispatchEvent(new Event("pointerdown"));
  expect(lock).toHaveBeenCalledOnce();
  stop();
});
