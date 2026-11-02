// Projection：AppSession → Surface。Surface 只是映射，不是第二份真相。
import { AppState } from './app-registry.mjs';

export function project(session, input = null) {
  if (!session || session.state === AppState.CLOSED) return null;
  const source = input || session.meta || {};
  return {
    appId: session.appId,
    kind: source.kind || session.meta?.kind || session.appId,
    view: source.view || session.meta?.view || null,
    snapshot: source.snapshot || null,
    layout: layoutFor(session),
    state: session.state,
    at: session.lastEventAt,
  };
}

export function layoutFor(session) {
  if (session.state === AppState.FOCUSED) return { space: 'full', z: 10, opacity: 1 };
  if (session.state === AppState.BACKGROUND) return { space: 'hidden', z: 0, opacity: 0 };
  return { space: 'pip', z: 5, opacity: 0.85 };
}

export function projectAll(registry, inputs = null) {
  return registry.list().map((s) => project(s, inputs ? inputs.get(s.appId) : null)).filter(Boolean);
}
