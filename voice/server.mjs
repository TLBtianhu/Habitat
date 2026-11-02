// Voice Server：Voice Library + Utterance；文字与语音动作分离，按需合成。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { VoiceLibrary } from './library.mjs';

const PORT = Number(process.env.HABITAT_VOICE_PORT || 9270);
const CONTROL = process.env.HABITAT_CONTROL_URL || 'http://127.0.0.1:9240';
const CACHE = process.env.HABITAT_TTS_CACHE || '/var/lib/habitat/cache/tts';
const UTTERANCE_LOG = process.env.HABITAT_UTTERANCE_LOG || '/var/lib/habitat/utterances.jsonl';
const AGENT_TOKEN = fs.readFileSync('/etc/habitat/agent.token', 'utf8').trim();
const OWNER_TOKEN = fs.readFileSync('/etc/habitat/owner.token', 'utf8').trim();
const library = new VoiceLibrary({
  directory: new URL('./profiles/', import.meta.url).pathname,
  defaultId: process.env.HABITAT_VOICE_PROFILE || 'generic/kokoro-zf-xiaoni',
});
const utterances = new Map();
const pendingSynthesis = new Map();
let nextId = 1;
let synthesisCount = 0;
fs.mkdirSync(CACHE, { recursive: true });

function publicUtterance(u) {
  return {
    id: u.id,
    messageId: u.messageId,
    source: u.source,
    text: u.text,
    voiceProfile: u.voiceProfile,
    voiceLabel: u.voiceLabel || u.voiceProfile,
    dafeiyu: u.dafeiyu === true,
    delivery: u.delivery || ['console'],
    priority: u.priority || 'normal',
    status: u.status,
    durationMs: u.durationMs || null,
    hash: u.hash || null,
    error: u.error || null,
    playback: u.playback || null,
    lastServedAt: u.lastServedAt || null,
    servedCount: u.servedCount || 0,
    audioUrl: `/voice/utterances/${u.id}/audio`,
    createdAt: u.createdAt,
  };
}
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4096) throw new Error('body too large');
  }
  return JSON.parse(text || '{}');
}
function normalizeWav(data) {
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF') return data;
  const wav = Buffer.from(data);
  wav.writeUInt32LE(wav.length - 8, 4);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') {
      wav.writeUInt32LE(wav.length - offset - 8, offset + 4);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return wav;
}
function wavDurationMs(data) {
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF') return null;
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let dataSize = 0;
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = data.readUInt16LE(offset + 10);
      sampleRate = data.readUInt32LE(offset + 12);
      bits = data.readUInt16LE(offset + 22);
    }
    if (id === 'data') { dataSize = Math.min(size, data.length - offset - 8); break; }
    offset += 8 + size + (size % 2);
  }
  const bytesPerSecond = sampleRate * channels * (bits / 8);
  return bytesPerSecond ? Math.round(dataSize / bytesPerSecond * 1000) : null;
}
function audioPath(id) { return path.join(CACHE, `${id}.wav`); }
function restoreUtterances() {
  let lines = [];
  try { lines = fs.readFileSync(UTTERANCE_LOG, 'utf8').split(/\r?\n/).filter(Boolean); } catch {}
  for (const line of lines) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (!Number.isSafeInteger(m.id) || typeof m.text !== 'string') continue;
    const ready = m.status === 'ready' && fs.existsSync(audioPath(m.id));
    utterances.set(m.id, {
      id: m.id,
      messageId: m.messageId || null,
      source: m.source || 'system',
      text: m.text,
      voiceProfile: m.voiceProfile || library.defaultId,
      voiceLabel: m.voiceLabel || m.voiceProfile || '历史音色',
      dafeiyu: m.dafeiyu === true,
      delivery: m.delivery || ['console'],
      priority: m.priority || 'normal',
      status: ready ? 'ready' : 'pending',
      durationMs: m.durationMs || null,
      hash: m.hash || null,
      bytes: m.bytes || null,
      playback: m.playback || null,
      lastServedAt: m.lastServedAt || null,
      servedCount: m.servedCount || 0,
      createdAt: m.createdAt || Date.now(),
    });
    nextId = Math.max(nextId, m.id + 1);
  }
}
restoreUtterances();
function persist(u) {
  fs.mkdirSync(path.dirname(UTTERANCE_LOG), { recursive: true });
  fs.appendFileSync(UTTERANCE_LOG, JSON.stringify({ ...publicUtterance(u), bytes: u.bytes || null }) + '\n', { mode: 0o600 });
}

async function synthesize(u) {
  if (u.status === 'ready') return;
  if (!library.enabled()) {
    const e = new Error('voice.library is closed');
    e.code = 409;
    throw e;
  }
  if (pendingSynthesis.has(u.id)) return pendingSynthesis.get(u.id);
  const promise = (async () => {
    u.status = 'synthesizing';
    u.error = null;
    try {
      persist(u);
      const backend = library.backendFor(u.voiceProfile);
      const probe = backend.probe();
      if (!probe.available) throw new Error('voice backend unavailable: ' + u.voiceProfile);
      const wav = normalizeWav(await backend.synthesize(u.text));
      const tmp = `${audioPath(u.id)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, wav, { mode: 0o600 });
      fs.renameSync(tmp, audioPath(u.id));
      u.hash = crypto.createHash('sha256').update(wav).digest('hex');
      u.durationMs = wavDurationMs(wav);
      u.bytes = wav.length;
      u.status = 'ready';
      synthesisCount += 1;
      persist(u);
    } catch (e) {
      u.status = 'error';
      u.error = e.message;
      persist(u);
      throw e;
    } finally {
      pendingSynthesis.delete(u.id);
    }
  })();
  pendingSynthesis.set(u.id, promise);
  return promise;
}

async function textForMessage(messageId) {
  const r = await fetch(`${CONTROL}/system/chat`, { signal: AbortSignal.timeout(5000) });
  const messages = await r.json();
  const message = messages.find((m) => m.id === Number(messageId));
  if (!message) {
    const e = new Error('system message not found: ' + messageId);
    e.code = 400;
    throw e;
  }
  if (message.from !== 'dafeiyu') {
    const e = new Error('only dafeiyu messages can be spoken');
    e.code = 403;
    throw e;
  }
  return message.text;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/status')) {
      const description = library.describe();
      return json(res, 200, {
        status: description.state === 'open' ? 'ok' : 'closed',
        library: description,
        synthesisCount,
        synthesizing: pendingSynthesis.size,
        utterances: utterances.size,
      });
    }
    if (req.method === 'GET' && url.pathname === '/profiles') {
      return json(res, 200, library.describe().profiles);
    }
    if (req.method === 'POST' && url.pathname === '/profiles/default') {
      if ((req.headers.authorization || '') !== `Bearer ${OWNER_TOKEN}`) return json(res, 403, { error: 'owner required' });
      const p = await readJson(req);
      const profile = library.setDefault(p.voiceProfile);
      return json(res, 200, { defaultProfile: profile.id, label: profile.label });
    }
    if (req.method === 'POST' && url.pathname === '/profiles/sample') {
      if ((req.headers.authorization || '') !== `Bearer ${OWNER_TOKEN}`) return json(res, 403, { error: 'owner required' });
      if (!library.enabled()) return json(res, 409, { error: 'voice.library is closed' });
      const p = await readJson(req);
      const profile = library.get(p.voiceProfile || library.defaultId);
      const text = String(p.text || '你好，这是音色试听。').trim().slice(0, 200);
      if (!text) return json(res, 400, { error: 'text required' });
      const u = {
        id: nextId++,
        messageId: null,
        source: 'owner-sample',
        text,
        voiceProfile: profile.id,
        voiceLabel: profile.label,
        dafeiyu: profile.dafeiyu === true,
        delivery: ['preview'],
        priority: 'normal',
        status: 'pending',
        createdAt: Date.now(),
      };
      utterances.set(u.id, u);
      persist(u);
      return json(res, 200, publicUtterance(u));
    }
    if (req.method === 'GET' && url.pathname === '/utterances') {
      const since = Number(url.searchParams.get('since') || 0);
      return json(res, 200, [...utterances.values()].filter((u) => u.id > since).slice(-50).map(publicUtterance));
    }
    if (req.method === 'POST' && url.pathname === '/utterances') {
      if ((req.headers.authorization || '') !== `Bearer ${AGENT_TOKEN}`) return json(res, 403, { error: 'agent required' });
      if (!library.enabled()) return json(res, 409, { error: 'voice.library is closed' });
      const p = await readJson(req);
      const messageId = p.messageId || null;
      const text = String(messageId ? await textForMessage(messageId) : (p.text || '')).trim().slice(0, 1000);
      if (!text) return json(res, 400, { error: 'text or dafeiyu messageId required' });
      const profile = library.get(p.voiceProfile || library.defaultId);
      const u = {
        id: nextId++,
        messageId,
        source: p.source || 'system',
        text,
        voiceProfile: profile.id,
        voiceLabel: profile.label,
        dafeiyu: profile.dafeiyu === true,
        delivery: Array.isArray(p.delivery) && p.delivery.length ? p.delivery.slice(0, 8) : ['console'],
        priority: ['interrupt', 'normal', 'background'].includes(p.priority) ? p.priority : 'normal',
        status: 'pending',
        createdAt: Date.now(),
      };
      utterances.set(u.id, u);
      if (utterances.size > 200) utterances.delete(utterances.keys().next().value);
      persist(u);
      return json(res, 200, publicUtterance(u));
    }
    const statusMatch = url.pathname.match(/^\/utterances\/(\d+)$/);
    if (req.method === 'GET' && statusMatch) {
      const u = utterances.get(Number(statusMatch[1]));
      return u ? json(res, 200, publicUtterance(u)) : json(res, 404, { error: 'utterance not found' });
    }
    const playbackMatch = url.pathname.match(/^\/utterances\/(\d+)\/playback$/);
    if (req.method === 'POST' && playbackMatch) {
      if ((req.headers.authorization || '') !== `Bearer ${OWNER_TOKEN}`) return json(res, 403, { error: 'owner required' });
      const u = utterances.get(Number(playbackMatch[1]));
      if (!u) return json(res, 404, { error: 'utterance not found' });
      const p = await readJson(req);
      if (!['started', 'completed', 'failed', 'cancelled'].includes(p.state)) return json(res, 400, { error: 'invalid playback state' });
      if (u.status !== 'ready' || !u.lastServedAt) return json(res, 409, { error: 'audio has not been served' });
      if (p.state === 'completed') {
        if (u.playback?.state !== 'started') return json(res, 409, { error: 'playback has not started' });
        if (u.durationMs && Date.now() - u.playback.at < u.durationMs * 0.5) return json(res, 409, { error: 'playback completed too early' });
      }
      u.playback = { state: p.state, at: Date.now(), error: String(p.error || '').slice(0, 300) || null };
      persist(u);
      return json(res, 200, publicUtterance(u));
    }
    const audioMatch = url.pathname.match(/^\/utterances\/(\d+)\/audio$/);
    if (req.method === 'GET' && audioMatch) {
      const u = utterances.get(Number(audioMatch[1]));
      if (!u) return json(res, 404, { error: 'utterance not found' });
      await synthesize(u);
      u.lastServedAt = Date.now();
      u.servedCount = (u.servedCount || 0) + 1;
      persist(u);
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'content-length': u.bytes,
        'cache-control': 'private, no-store',
        'x-utterance-id': String(u.id),
        'x-utterance-hash': u.hash,
      });
      fs.createReadStream(audioPath(u.id)).pipe(res);
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, Number(e.code) || 500, { error: e.message });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`[voice] 127.0.0.1:${PORT} voice.library=${library.enabled() ? 'open' : 'closed'}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
