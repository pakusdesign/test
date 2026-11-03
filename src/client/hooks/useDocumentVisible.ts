import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void): () => void {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
}

/** true, пока вкладка видима. В скрытой вкладке декоративное движение приостанавливается. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.visibilityState !== 'hidden',
    () => true,
  );
}
