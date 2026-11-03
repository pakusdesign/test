import { afterEach, expect, it, vi } from 'vitest';
import { createController } from '../../src/client/state/controller';
import { createStore } from '../../src/client/state/store';
import { initialState } from '../../src/client/state/transitions';
import { LIMITS } from '../../src/shared/constants';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('late failure of cancelled A preserves the timer and cancellation of B', async () => {
  vi.useFakeTimers();
  const calls: {signal: AbortSignal; reject: (reason: Error) => void}[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    calls.push({signal: options.signal!, reject});
  })));
  const store = createStore(initialState());
  const actions = createController(store);
  const first = actions.reanalyze();
  actions.cancelRequest();
  const second = actions.reanalyze();
  calls[0]!.reject(new DOMException('aborted', 'AbortError'));
  await first;
  await vi.advanceTimersByTimeAsync(LIMITS.slowNoticeMs);
  const slow = store.getState().slow;
  actions.cancelRequest();
  const aborted = calls[1]!.signal.aborted;
  calls[1]!.reject(new Error('cleanup'));
  await second;
  expect(slow).toBe(true);
  expect(aborted).toBe(true);
});
