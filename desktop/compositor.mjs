// Compositor：把 Surface 投影与 AppSession 合成 FramePlan（不是像素帧，是合成计划）
import { AppState } from './app-registry.mjs';
import { projectAll } from './projection.mjs';

export function compose(registry, inputs = null, { exclude = [] } = {}) {
  const excluded = new Set([
    ...exclude,
    ...registry.list().filter((s) => s.meta?.surface === false).map((s) => s.appId),
  ]);
  const current = registry.current();
  const surfaces = projectAll(registry, inputs).filter((s) => !excluded.has(s.appId));
  const taskbar = registry.list().filter((s) => !excluded.has(s.appId)).map((s) => ({
    appId: s.appId,
    state: s.state,
    badge: s.state === AppState.BACKGROUND && Date.now() - s.lastEventAt < 5000,
  }));
  return {
    main: current && !excluded.has(current.appId) ? current.appId : null,
    surfaces,
    taskbar,
    layers: [
      { type: 'background' },
      ...surfaces.filter((s) => s.layout.space === 'full').map((s) => ({ type: 'surface', appId: s.appId, layout: s.layout })),
      ...surfaces.filter((s) => s.layout.space === 'pip').map((s) => ({ type: 'surface', appId: s.appId, layout: s.layout })),
      { type: 'taskbar', items: taskbar },
    ],
    at: Date.now(),
  };
}
