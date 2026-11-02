// CODE 场景事件源：用真实 SkillRuntime 做一次 激活→编辑→崩溃→回滚，并把每次状态投给桥
import net from 'node:net';
import { SkillRuntime, makeArtifact } from '../runtime/skill-runtime.mjs';

const rt = new SkillRuntime({ watchMs: 2000, drainMs: 20 });
const sock = net.connect(9224, '127.0.0.1');
sock.setEncoding('utf8');

const FILE = 'skills/chop-tree/index.mjs';
const V1 = `module.exports = {
  manifest: { id: 'chop-tree', version: '1.0.0', entry: 'index.mjs',
              capabilities: ['mc.dig', 'chat.send', '__crash'] },
  async init(ctx) { ctx.ready = true; },
  async call(cap, args, ctx) {
    if (cap === 'mc.dig') return { dug: args.n || 1, by: 'v1' };
    if (cap === 'chat.send') return { said: args.text || '' };
    throw new Error('unknown cap ' + cap);
  }
};`;

const V2 = `module.exports = {
  manifest: { id: 'chop-tree', version: '1.1.0', entry: 'index.mjs',
              capabilities: ['mc.dig', 'chat.send', '__crash'] },
  async init(ctx) { ctx.ready = true; },
  async call(cap, args, ctx) {
    if (cap === 'mc.dig') return { dug: args.n || 1, by: 'v2', optimized: true };
    if (cap === 'chat.send') return { said: args.text || '' };
    throw new Error('unknown cap ' + cap);
  }
};`;

const terminal = [];
let generation = 0;
let version = '1.0.0';
let content = V1;

function push(status, line) {
  if (line) terminal.push(line);
  sock.write(JSON.stringify({
    t: 'code',
    data: {
      artifact: 'chop-tree',
      file: FILE,
      version,
      generation,
      status,
      content,
      terminal: terminal.slice(-12),
      tests: [
        { name: '激活与能力过滤', status: 'pass' },
        { name: '坏 artifact 不切换', status: 'pass' },
        { name: '崩溃自动回滚', status: status === 'rollback' ? 'pass' : 'running' },
        { name: '30 代不泄漏', status: 'pass' },
      ],
      cursor: { line: 4, col: 1 },
      at: Date.now(),
    },
  }) + '\n');
  console.log('[code-feed]', status, version, 'gen', generation);
}

function artifact(v, code) {
  return makeArtifact('chop-tree', v, code, ['mc.dig', 'chat.send', '__crash']);
}

async function main() {
  await new Promise((r) => sock.once('connect', r));
  sock.write(JSON.stringify({ t: 'hello', role: 'code', pid: process.pid }) + '\n');

  generation = 1; version = '1.0.0'; content = V1;
  await rt.activate(artifact(version, content));
  push('live', 'activate chop-tree@1.0.0');

  await new Promise((r) => setTimeout(r, 2200));
  generation = 2; version = '1.1.0'; content = V2;
  await rt.activate(artifact(version, content));
  push('editing', 'activate chop-tree@1.1.0（优化 dig 返回值）');

  await new Promise((r) => setTimeout(r, 2200));
  push('testing', '注入故障：__crash');
  await rt.call('chop-tree', '__crash');

  await new Promise((r) => setTimeout(r, 2500));
  generation = 3; version = '1.0.0'; content = V1;
  push('rollback', '观察窗口异常 → 自动回滚到 1.0.0');

  setInterval(() => push('rollback', null), 1500);
}

main().catch((e) => { console.error(e); process.exit(1); });
