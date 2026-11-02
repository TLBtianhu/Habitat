// 一键健康总览：桥 / 世界 / 流水线 / HLS / 能力清单
import fs from 'node:fs';

const out = { at: new Date().toISOString() };

try {
  const s = await (await fetch('http://127.0.0.1:9225/status')).json();
  out.bridge = {
    body: s.body, bot: s.bot, frames: s.frames, fps: s.fps,
    obsAgeMs: s.obsAgeMs, capsViolations: s.capsViolations,
  };
} catch (e) {
  out.bridge = { error: e.message };
}

try {
  const w = await (await fetch('http://127.0.0.1:9225/obs')).json();
  out.world = { pos: w.self?.pos, facing: w.self?.facing, health: w.self?.health, time: w.world?.time };
} catch (e) {
  out.world = { error: e.message };
}

try {
  const p = JSON.parse(fs.readFileSync('C:/Habitat/artifacts/pipeline.json', 'utf8'));
  out.pipeline = { out: p.out, standby: p.standby, frameAgeMs: p.frameAgeMs, framesOut: p.framesOut, chromeAlive: p.chromeAlive };
} catch (e) {
  out.pipeline = { error: e.message };
}

try {
  const r = await fetch('http://127.0.0.1:9230/hls/live.m3u8');
  out.hls = { status: r.status, url: 'http://127.0.0.1:9230/hls/live.m3u8' };
} catch (e) {
  out.hls = { error: e.message };
}

console.log(JSON.stringify(out, null, 2));
