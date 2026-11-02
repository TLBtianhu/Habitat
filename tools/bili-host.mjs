import fs from 'node:fs';
import { getWbiKeys, signWbi } from '../clients/bilibili-wbi.mjs';
const cookie = fs.readFileSync('/opt/habitat/src/artifacts/bilibili-cookies.txt', 'utf8').trim();
const mixin = await getWbiKeys(cookie);
const params = signWbi({ id: 545068, type: 0, web_location: '444.8' }, mixin);
const qs = new URLSearchParams(params).toString();
const d = await (await fetch('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?' + qs, {
  headers: { cookie, 'user-agent': 'Mozilla/5.0', referer: 'https://live.bilibili.com/545068' },
})).json();
console.log(JSON.stringify(d.data.host_list, null, 2));
