import fs from 'node:fs';
import pkg from 'bilibili-live-ws';
import { getWbiKeys, signWbi } from '../clients/bilibili-wbi.mjs';

const cookie = fs.readFileSync('/opt/habitat/src/artifacts/bilibili-cookies.txt', 'utf8').trim();
const mixin = await getWbiKeys(cookie);
const params = signWbi({ id: 545068, type: 0, web_location: '444.8' }, mixin);
const qs = new URLSearchParams(params).toString();
const conf = await (await fetch('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?' + qs, {
  headers: { cookie, 'user-agent': 'Mozilla/5.0', referer: 'https://live.bilibili.com/545068' },
})).json();
const host = conf.data.host_list[0].host;
const key = conf.data.token;
const buvid = /buvid3=([^;]+)/.exec(cookie)?.[1];
console.log('host', host, 'token', !!key, 'buvid', !!buvid);
const live = new pkg.LiveWS(545068, { address: `wss://${host}/sub`, key, uid: 0, protover: 2, buvid });
live.on('open', () => console.log('OPEN'));
live.on('DANMU_MSG', (d) => console.log('DANMU', d.info?.[1]));
live.on('SEND_GIFT', (d) => console.log('GIFT', d.data?.giftName, d.data?.uname));
live.on('close', () => console.log('CLOSE'));
live.on('error', (e) => console.log('ERROR', String(e)));
setTimeout(() => { live.close(); process.exit(0); }, 20000);
