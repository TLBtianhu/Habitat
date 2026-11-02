// ProjectionInput：客户端提交给桌面的投影输入（不是应用真相，只是最新快照）
const inputs = new Map();

export function setInput(appId, input) {
  if (!appId) throw new Error('appId required');
  inputs.set(appId, { ...(input || {}), at: Date.now() });
}

export function getInput(appId) {
  return inputs.get(appId) || null;
}

export function clearInput(appId) {
  inputs.delete(appId);
}
