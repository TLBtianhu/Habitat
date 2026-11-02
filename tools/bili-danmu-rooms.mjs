import fs from 'node:fs';
import { BilibiliClient } from '../clients/bilibili.mjs';
const cookie = fs.readFileSync('/opt/habitat/src/artifacts/bilibili-cookies.txt', 'utf8').trim();
const b = new BilibiliClient({ cookie });
for (const room of [545068, 23116434, 5279, 23058, 6]) {
  try {
    const d = await b.getDanmuInfo(room);
    console.log(room, JSON.stringify({ token: !!d.token, host: d.host_list?.[0]?.host }));
  } catch (e) {
    console.log(room, 'ERR', e.message);
  }
}
process.exit(0);
