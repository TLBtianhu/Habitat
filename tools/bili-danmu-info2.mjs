import fs from 'node:fs';
import { BilibiliClient } from '../clients/bilibili.mjs';
const cookie = fs.readFileSync('/opt/habitat/src/artifacts/bilibili-cookies.txt', 'utf8').trim();
const b = new BilibiliClient({ cookie });
try {
  const d = await b.getDanmuInfo(21484828);
  console.log(JSON.stringify({ token: !!d.token, host: d.host_list?.[0]?.host }));
} catch (e) {
  console.log('ERR', e.message);
}
process.exit(0);
