import fs from 'node:fs';
import zlib from 'node:zlib';
import { getWbiKeys, signWbi } from '../clients/bilibili-wbi.mjs';

const room = 545068;
const cookie = fs.readFileSync('/opt/habitat/src/artifacts/bilibili-cookies.txt', 'utf8').trim();
const mixin = await getWbiKeys(cookie);
const params = signWbi({ id: room, type: 0, web_location: '444.8' }, mixin);
const qs = new URLSearchParams(params).toString();
const conf = await (await fetch('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?' + qs, {
  headers: { cookie, 'user-agent': 'Mozilla/5.0', referer: 'https://live.bilibili.com/' + room },
})).json();
const host = conf.data.host_list[0].host;
const wssPort = conf.data.host_list[0].wss_port || 443;
const key = conf.data.token;
const buvid = /buvid3=([^;]+)/.exec(cookie)?.[1];
const uid = Number(/DedeUserID=(\d+)/.exec(cookie)?.[1] || 0);

function packet(obj, op = 7, ver = 1) {
  const body = Buffer.from(JSON.stringify(obj));
  const h = Buffer.alloc(16);
  h.writeUInt32BE(16 + body.length, 0);
  h.writeUInt16BE(16, 4);
  h.writeUInt16BE(ver, 6);
  h.writeUInt32BE(op, 8);
  h.writeUInt32BE(1, 12);
  return Buffer.concat([h, body]);
}

const ws = new WebSocket(`wss://${host}:${wssPort}/sub`);
ws.addEventListener('open', () => {
  console.log('OPEN');
  ws.send(packet({ uid, roomid: room, protover: 3, platform: 'web', type: 2, key, buvid }));
});
ws.addEventListener('message', async (ev) => {
  const buf = Buffer.from(await ev.data.arrayBuffer());
  const op = buf.readUInt32BE(8);
  const ver = buf.readUInt16BE(6);
  console.log('MSG op', op, 'ver', ver, 'len', buf.length);
  if (ver === 3) {
    try {
      const out = zlib.brotliDecompressSync(buf.subarray(16));
      let off = 0;
      while (off + 16 <= out.length) {
        const len = out.readUInt32BE(off);
        const hop = out.readUInt16BE(off + 4);
        const nver = out.readUInt16BE(off + 6);
        const nop = out.readUInt32BE(off + 8);
        if (len < 16 || off + len > out.length) break;
        const body = out.subarray(off + hop, off + len);
        if (nop === 5) {
          try {
            const j = JSON.parse(body.toString('utf8'));
            if (j.cmd?.includes('DANMU_MSG')) console.log('DANMU', j.info?.[1]);
            else console.log('CMD', j.cmd);
          } catch {}
        }
        off += len;
      }
    } catch (e) { console.log('brotli err', e.message); }
  } else if (ver === 2) {
    try {
      const out = zlib.inflateSync(buf.subarray(16));
      console.log('INFLATED', out.length, out.subarray(0, 80).toString('utf8'));
    } catch (e) { console.log('inflate err', e.message); }
  } else {
    console.log('BODY', buf.subarray(16, 200).toString('utf8'));
  }
});
ws.addEventListener('close', (ev) => console.log('CLOSE', ev.code, ev.reason));
ws.addEventListener('error', (e) => console.log('ERROR', String(e)));
setTimeout(() => { ws.close(); process.exit(0); }, 15000);
