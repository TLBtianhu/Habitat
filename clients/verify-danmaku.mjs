import fs from 'node:fs';
import { BiliDanmakuClient } from './bilibili-danmaku.mjs';
const cookie = fs.readFileSync('/opt/habitat/src/artifacts/bilibili-cookies.txt', 'utf8').trim();
const events = [];
const c = new BiliDanmakuClient({ roomId: 545068, cookie, onEvent: (e) => { events.push(e); if (e.type === 'danmaku') console.log('DANMU', e.text); } });
await c.connect();
setTimeout(() => { c.close(); console.log('events', events.length, 'danmaku', events.filter(e => e.type === 'danmaku').length); process.exit(0); }, 12000);
