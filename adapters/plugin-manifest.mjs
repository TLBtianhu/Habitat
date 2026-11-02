// AdapterManifest 的最小严格校验：声明、工具、权限和生命周期必须可对账。
const ID = /^[a-z][a-z0-9._-]{0,63}$/;
const TOOL = /^[a-z][a-z0-9._-]*\.[a-z][a-z0-9._-]+$/;
const LIFECYCLES = new Set(['adapter', 'provider', 'outlet', 'client', 'declarative']);
const CONCURRENCY = new Set(['serial', 'exclusive', 'parallel']);
const IDEMPOTENCY = new Set(['required', 'per-intent', 'none']);
const TOP_LEVEL = new Set([
  'schemaVersion', 'id', 'name', 'displayName', 'kind', 'version', 'sdkRange', 'entry', 'provider',
  'session', 'lifecycle', 'capabilities', 'authFlows', 'scopes', 'tools', 'obs', 'surface',
  'requires', 'permissions', 'configSchema', 'focus',
]);

function fail(file, message) { throw new Error(`${file}: ${message}`); }
function validateTool(tool, manifest, file) {
  if (!tool || typeof tool !== 'object') fail(file, 'tool must be object');
  if (!TOOL.test(tool.name || '')) fail(file, 'invalid tool name: ' + tool.name);
  if (typeof tool.handler !== 'string' || !tool.handler) fail(file, `${tool.name}: handler required`);
  if (tool.inputSchema == null || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
    fail(file, `${tool.name}: inputSchema must be object`);
  }
  if (tool.concurrency != null && !CONCURRENCY.has(tool.concurrency)) fail(file, `${tool.name}: bad concurrency`);
  if (tool.idempotency != null && !IDEMPOTENCY.has(tool.idempotency)) fail(file, `${tool.name}: bad idempotency`);
  if (tool.timeoutMs != null && (!Number.isSafeInteger(tool.timeoutMs) || tool.timeoutMs < 1 || tool.timeoutMs > 120000)) {
    fail(file, `${tool.name}: timeoutMs out of range`);
  }
  if (tool.scope != null && typeof tool.scope !== 'string') fail(file, `${tool.name}: scope must be string`);
  if (tool.scope && Array.isArray(manifest.scopes) && manifest.scopes.length && !manifest.scopes.includes(tool.scope)) {
    fail(file, `${tool.name}: scope ${tool.scope} not declared in scopes`);
  }
}

export function validateManifest(manifest, file = 'manifest.json') {
  const m = manifest;
  if (!m || typeof m !== 'object' || Array.isArray(m)) fail(file, 'manifest must be object');
  for (const key of Object.keys(m)) if (!TOP_LEVEL.has(key)) fail(file, 'unknown field: ' + key);
  if (m.schemaVersion !== 1) fail(file, 'schemaVersion must be 1');
  if (!ID.test(m.id || '')) fail(file, 'invalid id');
  if (m.name && m.name !== m.id) fail(file, 'name and id must match');
  if (typeof m.kind !== 'string' || !m.kind) fail(file, 'kind required');
  if (typeof m.version !== 'string' || !m.version) fail(file, 'version required');
  if (!LIFECYCLES.has(m.lifecycle)) fail(file, 'invalid lifecycle');
  if (m.session != null && (typeof m.session !== 'object' || typeof m.session.kind !== 'string')) {
    fail(file, 'session.kind required when session exists');
  }
  if (m.provider != null && (typeof m.provider !== 'string' || !m.provider.endsWith('.mjs'))) {
    fail(file, 'provider must be .mjs path');
  }
  if (m.tools != null && !Array.isArray(m.tools)) fail(file, 'tools must be array');
  const names = new Set();
  for (const tool of m.tools || []) {
    validateTool(tool, m, file);
    if (names.has(tool.name)) fail(file, 'duplicate tool: ' + tool.name);
    names.add(tool.name);
  }
  if (names.size && !m.provider) fail(file, 'provider required when tools exist');
  if (m.requires != null && (!Array.isArray(m.requires) || m.requires.some((x) => typeof x !== 'string'))) {
    fail(file, 'requires must be string array');
  }
  if (m.permissions != null && (!Array.isArray(m.permissions) || m.permissions.some((x) => typeof x !== 'string'))) {
    fail(file, 'permissions must be string array');
  }
  return m;
}
