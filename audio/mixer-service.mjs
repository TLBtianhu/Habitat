// Continuous Audio Mixer：Voice PCM → 48kHz stereo PCM，按需捕获，不与 Desktop/编码器合并。
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.HABITAT_AUDIO_PORT || 9271);
const VOICE = process.env.HABITAT_VOICE_URL || 'http://127.0.0.1:9270';
const RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_20MS = Math.round(RATE * CHANNELS * 2 * 0.02);
const MAX_QUEUE_BYTES = RATE * CHANNELS * 2 * 5;
const captures = new Map();
let pollTimer = null;
let polling = false;
let voiceWatermark = 0;

function decodeWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
  let offset = 12;
  let format = null;
  let pcm = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      format = {
        codec: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        rate: buffer.readUInt32LE(offset + 12),
        bits: buffer.readUInt16LE(offset + 22),
      };
    }
    if (id === 'data') { pcm = buffer.subarray(offset + 8); break; }
    offset += 8 + size + (size % 2);
  }
  if (!format || format.codec !== 1 || format.bits !== 16 || !pcm) throw new Error('unsupported WAV');
  return { ...format, pcm };
}
function to48kStereo(wav) {
  const source = decodeWav(wav);
  const frames = Math.floor(source.pcm.length / (2 * source.channels));
  const outputFrames = Math.floor(frames * RATE / source.rate);
  const out = Buffer.alloc(outputFrames * 4);
  const sample = (frame, channel) => {
    const f = Math.max(0, Math.min(frames - 1, frame));
    return source.pcm.readInt16LE((f * source.channels + channel) * 2);
  };
  for (let i = 0; i < outputFrames; i++) {
    const position = i * source.rate / RATE;
    const left = Math.floor(position);
    const fraction = position - left;
    for (let channel = 0; channel < 2; channel++) {
      const sourceChannel = source.channels === 1 ? 0 : channel;
      const a = sample(left, sourceChannel);
      const b = sample(left + 1, sourceChannel);
      out.writeInt16LE(Math.round(a + (b - a) * fraction), i * 4 + channel * 2);
    }
  }
  return out;
}
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return JSON.parse(text || '{}');
}
function publicCapture(c) {
  return { id: c.id, consumer: c.consumer || null, instanceId: c.instanceId || null, baseline: c.baseline, queuedMs: Math.round(c.queue.length / (RATE * CHANNELS * 2) * 1000), streaming: !!c.res };
}
function stopPollIfIdle() {
  if (!captures.size && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
async function pollVoice() {
  if (polling || !captures.size) return;
  polling = true;
  try {
    const r = await fetch(`${VOICE}/utterances?since=${voiceWatermark}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`voice HTTP ${r.status}`);
    const items = await r.json();
    for (const u of items) {
      voiceWatermark = Math.max(voiceWatermark, u.id);
      if (u.status === 'error') continue;
      try {
        const audio = await fetch(`${VOICE}/utterances/${u.id}/audio`, { signal: AbortSignal.timeout(120000) });
        if (!audio.ok) continue;
        const pcm = to48kStereo(Buffer.from(await audio.arrayBuffer()));
        for (const c of captures.values()) {
          if (u.id <= c.baseline) continue;
          c.queue = Buffer.concat([c.queue, pcm]);
          if (c.queue.length > MAX_QUEUE_BYTES) c.queue = c.queue.subarray(c.queue.length - MAX_QUEUE_BYTES);
        }
      } catch (e) { console.log('[audio] utterance failed', u.id, e.message); }
    }
  } catch (e) {
    console.log('[audio] voice poll failed', e.message);
  } finally {
    polling = false;
  }
}
function startStream(c, res) {
  const write = () => {
    if (!c.res) return;
    let chunk;
    if (c.queue.length >= BYTES_PER_20MS) {
      chunk = c.queue.subarray(0, BYTES_PER_20MS);
      c.queue = c.queue.subarray(BYTES_PER_20MS);
    } else {
      chunk = Buffer.alloc(BYTES_PER_20MS);
      c.queue.copy(chunk);
      c.queue = Buffer.alloc(0);
    }
    if (!c.res.write(chunk)) {
      clearInterval(c.streamTimer);
      c.res.once('drain', () => { if (c.res) c.streamTimer = setInterval(write, 20); });
    }
  };
  c.streamTimer = setInterval(write, 20);
}
async function closeCapture(id) {
  const c = captures.get(id);
  if (!c) return { alreadyStopped: true };
  captures.delete(id);
  if (c.streamTimer) clearInterval(c.streamTimer);
  if (c.res) c.res.end();
  stopPollIfIdle();
  return { closed: true, id };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/status')) {
      return json(res, 200, {
        running: captures.size > 0,
        format: { codec: 's16le', rate: RATE, channels: CHANNELS },
        voiceWatermark,
        captures: [...captures.values()].map(publicCapture),
      });
    }
    if (req.method === 'POST' && url.pathname === '/capture/open') {
      const input = await readJson(req);
      const current = await (await fetch(`${VOICE}/utterances`)).json();
      const baseline = current.reduce((max, u) => Math.max(max, u.id), 0);
      if (!voiceWatermark) voiceWatermark = baseline;
      const id = crypto.randomUUID();
      captures.set(id, {
        id,
        consumer: String(input.consumer || 'unknown').slice(0, 64),
        instanceId: input.instanceId ? String(input.instanceId).slice(0, 80) : null,
        baseline,
        queue: Buffer.alloc(0),
        res: null,
        streamTimer: null,
      });
      if (!pollTimer) pollTimer = setInterval(pollVoice, 250);
      return json(res, 200, { id, baseline, format: { codec: 's16le', rate: RATE, channels: CHANNELS } });
    }
    if (req.method === 'POST' && url.pathname === '/capture/close') {
      const { id } = await readJson(req);
      return json(res, 200, await closeCapture(id));
    }
    if (req.method === 'GET' && url.pathname === '/capture/pcm') {
      const c = captures.get(url.searchParams.get('id'));
      if (!c) return json(res, 404, { error: 'capture not found' });
      if (c.res) return json(res, 409, { error: 'capture already streaming' });
      c.res = res;
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        'x-audio-format': `s16le;rate=${RATE};channels=${CHANNELS}`,
      });
      res.on('close', () => { closeCapture(c.id); });
      startStream(c, res);
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message });
    else res.end();
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`[audio] 127.0.0.1:${PORT} pcm=${RATE}Hz/${CHANNELS}ch`));
process.on('SIGTERM', () => { for (const id of [...captures.keys()]) closeCapture(id); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { for (const id of [...captures.keys()]) closeCapture(id); server.close(() => process.exit(0)); });
