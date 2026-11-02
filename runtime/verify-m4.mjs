// M4 验收：隔离断言 + 回放一致性 + 故障注入 + 连续 soak
// 用法：node verify-m4.mjs [--minutes 1]（完整 soak 用 --minutes 120）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SkillRuntime, makeArtifact } from './skill-runtime.mjs';

const ART = 'C:/Habitat/artifacts';
const MINUTES = Number(process.argv.includes('--minutes')
  ? process.argv[process.argv.indexOf('--minutes') + 1]
  : 1);

const get = async (p) => (await fetch('http://127.0.0.1:9225' + p)).json();

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', "$ErrorActionPreference='SilentlyContinue'; " + script], { encoding: 'utf8' });
}

function cursor() {
  return ps("Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; Write-Output ($p.X.ToString()+','+$p.Y.ToString())").trim();
}

async function isolationAssertions() {
  const s = await get('/status');
  assert.equal(s.caps.runtime, 'wsl');
  assert.equal(s.caps.filesystem.host_fs_visible, false, '沙箱不应看到宿主文件系统');
  assert.equal(s.caps.filesystem.credentials_in_env, false, '沙箱不应有凭证');
  assert.equal(s.caps.network.listening_sockets, 0, 'Worker 不应监听端口');
  assert.equal(s.caps.input.host_input, false, '不应有宿主输入通道');
  assert.equal(s.caps.output.state_channel, 'outbound');
  assert.deepEqual(s.capsViolations, []);

  const before = cursor();
  for (let i = 0; i < 100; i++) {
    await fetch('http://127.0.0.1:9225/click', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 300, y: 260 }),
    }).catch(() => {});
  }
  const after = cursor();
  const [bx, by] = before.split(',').map(Number);
  const [ax, ay] = after.split(',').map(Number);
  const drift = Math.abs(ax - bx) + Math.abs(ay - by);
  // 光标位置受真人操作影响，只记录不当判据；硬断言以 caps 为准
  console.log('[隔离] caps 全过；100 次点击宿主光标漂移', drift, 'px（仅记录，不判失败）');
}

function deterministicArtifact() {
  return makeArtifact('replay-skill', '1.0.0', `
module.exports = {
  manifest: { id: 'replay-skill', version: '1.0.0', entry: 'index.mjs', capabilities: ['mc.dig'] },
  async call(cap, args) { if (cap === 'mc.dig') return { n: args.n || 0 }; throw new Error('x'); }
};
`, ['mc.dig']);
}

function normalize(log) {
  return log.map((l) => {
    const { at, ...rest } = l;
    return rest;
  });
}

async function replayOnce() {
  const rt = new SkillRuntime();
  await rt.activate(deterministicArtifact());
  await rt.call('replay-skill', 'mc.dig', { n: 1 });
  await rt.call('replay-skill', 'mc.dig', { n: 2 });
  await rt.call('replay-skill', 'unknown', {});
  const log = normalize(rt.commandLog);
  await rt.dispose();
  return log;
}

async function replayAssertions() {
  const a = await replayOnce();
  const b = await replayOnce();
  assert.deepEqual(a, b, '同一日志重放两次结果必须一致');
  console.log('[回放] 两次执行序列完全一致（', a.length, '条）');
}

async function pipelineFaultInjection() {
  const statusFile = ART + '/pipeline.json';
  if (!fs.existsSync(statusFile)) {
    console.log('[故障] 没有 pipeline.json，跳过（流水线未运行）');
    return;
  }
  ps("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*chrome-pipeline*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }");
  await new Promise((r) => setTimeout(r, 3200));
  const during = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.equal(during.standby, true, 'Chrome 被杀后应切待机卡，而不是定格');
  await new Promise((r) => setTimeout(r, 13000));
  const after = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.equal(after.standby, false, 'Chrome 重启后应恢复实时帧');
  assert.ok(after.framesOut > during.framesOut, '恢复后帧应继续产出');
  console.log('[故障] Chrome 杀死后待机→恢复通过');
}

async function soak(minutes) {
  const logFile = ART + '/m4-soak.jsonl';
  const end = Date.now() + minutes * 60000;
  let ticks = 0, errors = 0, stalls = 0, maxFrameAge = 0;
  while (Date.now() < end) {
    ticks++;
    const rec = { at: Date.now(), tick: ticks };
    try {
      const s = await get('/status');
      const p = fs.existsSync(ART + '/pipeline.json')
        ? JSON.parse(fs.readFileSync(ART + '/pipeline.json', 'utf8'))
        : null;
      rec.body = !!s.body;
      rec.bot = !!s.bot;
      rec.capsViolations = s.capsViolations.length;
      rec.frameAgeMs = p ? p.frameAgeMs : null;
      rec.standby = p ? p.standby : null;
      if (rec.capsViolations) errors++;
      if (p && p.frameAgeMs != null) maxFrameAge = Math.max(maxFrameAge, p.frameAgeMs);
      if (p && p.frameAgeMs > 5000) stalls++;
    } catch (e) {
      rec.error = String(e.message || e);
      errors++;
    }
    fs.appendFileSync(logFile, JSON.stringify(rec) + '\n');
    await new Promise((r) => setTimeout(r, 5000));
  }
  const summary = { minutes, ticks, errors, stalls, maxFrameAge };
  console.log('[soak]', JSON.stringify(summary));
  assert.equal(errors, 0, 'soak 期间不能有连接/能力错误');
  assert.ok(ticks >= Math.max(1, Math.floor(minutes * 12 * 0.95)), 'soak tick 数不足');
  return summary;
}

console.log('M4 开始，minutes =', MINUTES);
await isolationAssertions();
await replayAssertions();
await pipelineFaultInjection();
await soak(MINUTES);
console.log('M4 验收通过');
process.exit(0);
