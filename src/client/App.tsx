import { useEffect, useState } from 'react';
import { AppView } from './AppView';
import { createController, type ControllerDeps } from './state/controller';
import { SessionContext, createStore } from './state/store';
import { initialState } from './state/transitions';

declare global {
  interface Window {
    /** Только для автоматических проверок: потоки микрофона для контроля остановки треков. */
    __vbStreams?: MediaStream[];
  }
}

export function App() {
  const [ctx] = useState(() => {
    const store = createStore(initialState());
    const deps: ControllerDeps = {};
    if (window.__vbStreams) deps.onStream = (stream) => window.__vbStreams?.push(stream);
    return { store, actions: createController(store, deps) };
  });
  useEffect(() => {
    const cleanup = ctx.actions.init();
    void ctx.actions.loadConfig();
    return cleanup;
  }, [ctx]);
  return (
    <SessionContext.Provider value={ctx}>
      <AppView />
    </SessionContext.Provider>
  );
}
