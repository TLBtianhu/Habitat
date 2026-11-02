// PluginRegistry：manifest 声明 + provider 实现 + Loader 所有权。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from './plugin-manifest.mjs';
import { DurableOutbox } from '../agent/durable-outbox.mjs';

function requiredFields(schema) { return Array.isArray(schema?.required) ? schema.required : []; }
function validateValue(value, schema, label) {
  const type = schema?.type;
  if (type === 'string' && typeof value !== 'string') throw new Error(label + ' must be string');
  if (type === 'number' && typeof value !== 'number') throw new Error(label + ' must be number');
  if (type === 'boolean' && typeof value !== 'boolean') throw new Error(label + ' must be boolean');
  if (type === 'array' && !Array.isArray(value)) throw new Error(label + ' must be array');
  if (type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    throw new Error(label + ' must be object');
  }
}
function validateArgs(schema, args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('tool args must be object');
  const properties = schema?.properties || {};
  for (const key of Object.keys(args)) {
    if (key === 'idempotencyKey') continue;
    if (schema?.additionalProperties === false && !(key in properties)) throw new Error('unknown arg: ' + key);
  }
  for (const key of requiredFields(schema)) {
    if (args[key] == null) throw new Error('missing arg: ' + key);
  }
  for (const [key, value] of Object.entries(args)) {
    if (properties[key]) validateValue(value, properties[key], key);
  }
}
export class PluginRegistry {
  constructor({ manifests, adapterHost = null, outletHost = null, providerContext = {}, outbox = null, outboxFile = null }) {
    this.manifests = new Map();
    this.tools = new Map();
    this.providers = new Map();
    this.queues = new Map();
    this.outbox = outbox || new DurableOutbox({ file: outboxFile || process.env.HABITAT_OUTBOX || '/var/lib/habitat/outbox/agent.json' });
    this.adapterHost = adapterHost;
    this.outletHost = outletHost;
    this.providerContext = providerContext;
    for (const m of manifests) {
      if (this.manifests.has(m.id)) throw new Error('duplicate plugin id: ' + m.id);
      this.manifests.set(m.id, m);
      for (const tool of m.tools || []) {
        if (this.tools.has(tool.name)) throw new Error('duplicate tool: ' + tool.name);
        this.tools.set(tool.name, { ...tool, pluginId: m.id });
      }
    }
  }

  static fromDirectories(dirs, options = {}) {
    const manifests = [];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir).sort()) {
        const file = path.join(dir, name, 'manifest.json');
        if (!fs.existsSync(file)) continue;
        const manifest = validateManifest(JSON.parse(fs.readFileSync(file, 'utf8')), file);
        manifests.push({ ...manifest, dir: path.join(dir, name) });
      }
    }
    return new PluginRegistry({ ...options, manifests });
  }

  list() { return [...this.manifests.values()]; }
  get(id) {
    const m = this.manifests.get(id);
    if (!m) throw new Error('unknown plugin: ' + id);
    return m;
  }
  toolNames() { return [...this.tools.keys()]; }
  getTool(name) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error('unknown tool: ' + name);
    return tool;
  }
  listTools() {
    return this.toolNames().map((name) => {
      const t = this.getTool(name);
      return { name: t.name, description: t.description || '', inputSchema: t.inputSchema };
    });
  }

  openSessions(session, focus = 'mc') {
    for (const m of this.manifests.values()) {
      if (!m.session) continue;
      const { kind, ...rest } = m.session;
      session.open(m.id, { kind, ...rest });
    }
    if (focus && this.manifests.has(focus)) session.focus(focus);
  }

  async start(id) {
    const m = this.get(id);
    if (m.lifecycle === 'adapter') {
      if (!this.adapterHost) throw new Error('adapter lifecycle unavailable: ' + id);
      return this.adapterHost.start(id);
    }
    if (m.lifecycle === 'outlet') {
      if (!this.outletHost) throw new Error('outlet lifecycle unavailable: ' + id);
      return this.outletHost.start(id);
    }
    return { accepted: false, lifecycle: m.lifecycle, id };
  }

  async stop(id) {
    const m = this.get(id);
    if (m.lifecycle === 'adapter') {
      if (!this.adapterHost) throw new Error('adapter lifecycle unavailable: ' + id);
      return this.adapterHost.stop(id);
    }
    if (m.lifecycle === 'outlet') {
      if (!this.outletHost) throw new Error('outlet lifecycle unavailable: ' + id);
      return this.outletHost.stop(id);
    }
    return { accepted: false, lifecycle: m.lifecycle, id };
  }

  async handlers(pluginId) {
    if (this.providers.has(pluginId)) return this.providers.get(pluginId);
    const m = this.get(pluginId);
    if (!m.provider) throw new Error('plugin has no provider: ' + pluginId);
    const module = await import(pathToFileURL(path.join(m.dir, m.provider)).href);
    if (typeof module.createHandlers !== 'function') throw new Error('provider must export createHandlers: ' + pluginId);
    const handlers = await module.createHandlers(this.providerContext);
    if (!handlers || typeof handlers !== 'object') throw new Error('invalid handlers: ' + pluginId);
    this.providers.set(pluginId, handlers);
    return handlers;
  }

  async call(name, args = {}) {
    const tool = this.getTool(name);
    validateArgs(tool.inputSchema, args);
    const previous = this.queues.get(name) || Promise.resolve();
    const execute = async () => {
      const handlers = await this.handlers(tool.pluginId);
      const handler = handlers[tool.handler];
      if (typeof handler !== 'function') throw new Error(`handler not found: ${tool.pluginId}.${tool.handler}`);
      try {
        return await this.outbox.execute({
          key: args.idempotencyKey || null,
          verb: name,
          args,
          timeoutMs: tool.timeoutMs || 10000,
          run: () => handler(args),
        });
      } catch (e) {
        if (e.message === 'timeout') return { ok: false, error: 'timeout', accepted: true };
        throw e;
      }
    };
    const run = tool.concurrency === 'parallel' ? execute() : previous.catch(() => {}).then(execute);
    if (tool.concurrency !== 'parallel') this.queues.set(name, run);
    else this.queues.set(name, run);
    try { return await run; }
    finally {
      if (this.queues.get(name) === run) this.queues.delete(name);
    }
  }

  describe() {
    return this.list().map((m) => ({
      id: m.id,
      version: m.version,
      lifecycle: m.lifecycle,
      session: m.session || null,
      tools: (m.tools || []).map((t) => t.name),
      outbox: this.outbox.status(),
    }));
  }
}

export { validateArgs };
