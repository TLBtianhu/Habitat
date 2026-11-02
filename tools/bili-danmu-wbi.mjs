import fs from 'node:fs';
import { getWbiKeys, signWbi } from '../clients/bilibili-wbi.mjs';
const cookie = fs.readFileSync('/opt/habitat/src/artifacts/bilibili-cookies.txt', 'utf8').trim();
const mixin = await getWbiKeys(cookie);
const params = signWbi({ id: 545068, type: 0, web_location: '444.8' }, mixin);
const qs = new URLSearchParams(params).toString();
const r = await fetch('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?' + qs, {
  headers: {
    cookie,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    referer: 'https://live.bilibili.com/545068',
  },
});
const d = await r.json();
console.log(JSON.stringify({ code: d.code, message: d.message, token: !!d.data?.token, host: d.data?.host_list?.[0]?.host }));
