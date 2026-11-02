import fs from 'node:fs';
import { BilibiliClient } from '../clients/bilibili.mjs';
const cfg = JSON.parse(fs.readFileSync('/etc/habitat/bilibili.json', 'utf8'));
const b = new BilibiliClient({ sessdata: cfg.sessdata });
try {
  const d = await b.getDanmuInfo(21484828);
  console.log(JSON.stringify({ token: !!d.token, host: d.host_list?.[0]?.host }));
} catch (e) {
  console.log('ERR', e.message);
}
process.exit(0);
