import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Actions } from './controller';
import type { SessionState } from './types';

export interface Store {
  getState(): SessionState;
  setState(next: SessionState | ((s: SessionState) => SessionState)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore(initial: SessionState): Store {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(next) {
      const value = typeof next === 'function' ? next(state) : next;
      if (value === state) return;
      state = value;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface SessionContextValue {
  store: Store;
  actions: Actions;
  /** Галерея: статичное состояние без побочных эффектов. */
  preview?: boolean;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

function useCtx(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionContext не найден');
  return ctx;
}

export function useSession(): SessionState {
  const { store } = useCtx();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useActions(): Actions {
  return useCtx().actions;
}

export function useIsPreview(): boolean {
  return Boolean(useCtx().preview);
}
