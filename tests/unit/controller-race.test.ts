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

it('allows the next text answer while analysis is pending and ignores the cancelled result', async () => {
  const calls: { signal: AbortSignal; reject: (reason: Error) => void }[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    calls.push({ signal: options.signal!, reject });
  })));
  const store = createStore(initialState());
  const actions = createController(store);
  const first = actions.reanalyze();
  actions.goToQuestion(1);
  expect(store.getState().questionIndex).toBe(1);
  actions.openComposer();
  expect(calls[0]!.signal.aborted).toBe(true);
  actions.setComposerText('Ежедневно готовит отчёт по проекту.');
  const second = actions.submitComposer();
  expect(store.getState().answers.some((answer) => answer.questionId === 'q2' && answer.active)).toBe(true);
  expect(calls).toHaveLength(2);
  calls[0]!.reject(new DOMException('aborted', 'AbortError'));
  await first;
  expect(store.getState().request?.questionId).toBe('q2');
  actions.cancelRequest();
  calls[1]!.reject(new DOMException('aborted', 'AbortError'));
  await second;
});
