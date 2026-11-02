// MCP 插件验收：initialize / tools/list / tools/call，全部读取统一 PluginRegistry。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const outboxFile = `/tmp/habitat-mcp-outbox-${process.pid}.json`;

const bridge = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.url === '/obs') { res.end(JSON.stringify({ self: { pos: [1, 2, 3] }, action: { isIdle: true } })); return; }
  res.end(JSON.stringify({ ok: true }));
});
await new Promise((r) => bridge.listen(9225, '127.0.0.1', r));
const proc = spawn(process.execPath, [fileURLToPath(new URL('./mc-server.mjs', import.meta.url))], {
  env: { ...process.env, FB_BRIDGE: 'http://127.0.0.1:9225', HABITAT_OUTBOX: outboxFile },
  stdio: ['pipe', 'pipe', 'ignore'],
});
const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
const pending = new Map();
let seq = 0;
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
function call(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

console.log('[1] initialize');
const init = await call('initialize');
assert.equal(init.result.serverInfo.name, 'habitat-mc');
console.log('  ok');

console.log('[2] tools/list');
const list = await call('tools/list');
assert.deepEqual(list.result.tools.map((t) => t.name), ['mc.obs', 'mc.say', 'mc.look', 'mc.stop']);
console.log('  ok');

console.log('[3] tools/call mc.obs');
const obs = await call('tools/call', { name: 'mc.obs', arguments: {} });
assert.ok(obs.result.content[0].text.includes('"self"'));
console.log('  ok');

proc.kill();
bridge.close();
fs.rmSync(outboxFile, { force: true });
console.log('MCP 插件验收通过');
