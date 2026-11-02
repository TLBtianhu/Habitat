// MC MCP Server：tools/list 与真实执行共用 PluginRegistry，避免两份工具表漂移。
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PluginRegistry } from '../adapters/plugin-registry.mjs';

const BRIDGE = process.env.FB_BRIDGE;
if (!BRIDGE) throw new Error('FB_BRIDGE 未配置；旧 9225 无鉴权桥不会作为默认发行面');
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createRegistry() {
  const client = {
    obs: async () => (await fetch(BRIDGE + '/obs')).json(),
    act: async ({ verb, args }) => (await fetch(BRIDGE + '/cmd', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verb, args }),
    })).json(),
  };
  return PluginRegistry.fromDirectories([
    path.join(APP_ROOT, 'adapters'),
    path.join(APP_ROOT, 'plugins'),
  ], { providerContext: { client } });
}

export function createServer({ registry = createRegistry() } = {}) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  const list = () => registry.listTools().filter((t) => registry.getTool(t.name).pluginId === 'mc');

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const { id, method, params } = msg;
    try {
      if (method === 'initialize') {
        out({ jsonrpc: '2.0', id, result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'habitat-mc', version: '0.2.0' },
        } });
        return;
      }
      if (method === 'tools/list') {
        out({ jsonrpc: '2.0', id, result: { tools: list() } });
        return;
      }
      if (method === 'tools/call') {
        if (registry.getTool(params.name).pluginId !== 'mc') throw new Error('not an MC tool');
        const result = await registry.call(params.name, params.arguments || {});
        out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
        return;
      }
      out({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
    } catch (e) {
      out({ jsonrpc: '2.0', id, error: { code: -32000, message: String(e.message || e) } });
    }
  });
  return { close: () => rl.close(), list };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) createServer();
