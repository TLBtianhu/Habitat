// B 站 RTMP 配置：长期复用，秘密只写入，状态与推流输出分开验证。
import fs from 'node:fs';
import path from 'node:path';

export function readLiveConfig(file) {
  if (!fs.existsSync(file)) return { rtmpUrl: '', streamKey: '' };
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { rtmpUrl: String(value.rtmpUrl || ''), streamKey: String(value.streamKey || '') };
}

export function validateLiveConfig(value) {
  const rtmpUrl = String(value.rtmpUrl || '').trim();
  const streamKey = String(value.streamKey || '').trim();
  if (!rtmpUrl && !streamKey) return { rtmpUrl: '', streamKey: '' };
  if (!rtmpUrl || !streamKey) throw new Error('rtmpUrl and streamKey are required together');
  if (rtmpUrl.length > 2048 || streamKey.length > 512 || /[\r\n]/.test(rtmpUrl) || /[\r\n]/.test(streamKey)) throw new Error('invalid live config');
  let url;
  try { url = new URL(rtmpUrl); } catch { throw new Error('invalid RTMP URL'); }
  if (!['rtmp:', 'rtmps:'].includes(url.protocol) || !url.host || url.username || url.password || url.search || url.hash) throw new Error('invalid RTMP URL');
  return { rtmpUrl: url.toString().replace(/\/$/, ''), streamKey };
}

export function writeLiveConfig(file, value) {
  const valid = validateLiveConfig(value);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(valid, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
  return valid;
}

export function publicLiveConfig(value) {
  return { rtmpUrl: value.rtmpUrl, streamKeySet: Boolean(value.streamKey) };
}
