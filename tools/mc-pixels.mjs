// 原生 MC 像素自声明：用 Xvfb 的 x11grab 抓帧，写入 Desktop 的 pixel surface
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = '/var/lib/habitat/artifacts/mc-pixels.jpg';
fs.mkdirSync('/var/lib/habitat/artifacts', { recursive: true });

function capture() {
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-video_size', '1280x720', '-i', ':99', '-frames:v', '1', OUT], { timeout: 15000 });
  } catch (e) {
    console.log('[pixels] capture failed', e.message);
  }
}

console.log('[pixels] capturing native MC ->', OUT);
setInterval(capture, 1000);
capture();
