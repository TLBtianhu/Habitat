// StreamPolicy：自主开播边界。默认关闭，不把推流地址、密钥或任意 URL 交给模型。
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  autonomous: 'off',
  allowedOutputs: ['bilibili'],
  rooms: ['default'],
  scenes: ['desktop-main'],
  maxDurationMs: 3600000,
  maxDailyMs: 7200000,
  cooldownMs: 600000,
  stopOnEvidenceFailure: true,
  requireVerified: true,
  verificationTimeoutMs: 60000,
  timeZone: 'Asia/Shanghai',
  windows: [],
};

function normalize(value = {}) {
  const next = { ...DEFAULTS, ...value };
  if (!['off', 'anytime', 'windowed'].includes(next.autonomous)) throw new Error('invalid autonomous mode');
  if (!Array.isArray(next.allowedOutputs) || !next.allowedOutputs.length || next.allowedOutputs.some((output) => output !== 'bilibili')) throw new Error('unsupported output');
  for (const key of ['rooms', 'scenes']) {
    if (!Array.isArray(next[key]) || !next[key].length || next[key].some((item) => typeof item !== 'string' || !item.trim() || item.length > 64)) throw new Error(`invalid ${key}`);
  }
  for (const [key, min, max] of [['maxDurationMs', 1000, 86400000], ['maxDailyMs', 1000, 2678400000], ['cooldownMs', 0, 86400000], ['verificationTimeoutMs', 1000, 300000]]) {
    if (!Number.isSafeInteger(next[key]) || next[key] < min || next[key] > max) throw new Error(`invalid ${key}`);
  }
  if (next.maxDailyMs < next.maxDurationMs) throw new Error('maxDailyMs must be >= maxDurationMs');
  next.stopOnEvidenceFailure = Boolean(next.stopOnEvidenceFailure);
  next.requireVerified = Boolean(next.requireVerified);
  if (typeof next.timeZone !== 'string' || next.timeZone.length > 64) throw new Error('invalid timeZone');
  try { new Intl.DateTimeFormat('en-US', { timeZone: next.timeZone }).format(); } catch { throw new Error('invalid timeZone'); }
  if (!Array.isArray(next.windows) || next.windows.length > 32) throw new Error('invalid windows');
  next.windows = next.windows.map((window) => {
    if (!window || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.end) || !Array.isArray(window.days) || !window.days.length || window.days.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 6)) throw new Error('invalid window');
    return { start: window.start, end: window.end, days: [...new Set(window.days)] };
  });
  if (next.autonomous === 'windowed' && !next.windows.length) throw new Error('windowed requires windows');
  return next;
}

export class StreamPolicyStore {
  constructor({ file = process.env.HABITAT_STREAM_POLICY_FILE || '/opt/habitat/config/stream-policy.json' } = {}) {
    this.file = file;
    this.config = this.read();
  }

  read() {
    if (!fs.existsSync(this.file)) return normalize(DEFAULTS);
    return normalize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
  }

  get() {
    return structuredClone(this.config);
  }

  save(body) {
    const next = normalize({ ...this.config, ...body });
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.config = next;
    return this.get();
  }
}
