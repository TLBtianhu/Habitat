import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('/etc/habitat/bilibili.json', 'utf8'));
const r = await fetch('https://api.bilibili.com/x/web-interface/nav', {
  headers: {
    cookie: `SESSDATA=${cfg.sessdata}`,
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Habitat/0.2',
    referer: 'https://www.bilibili.com/',
  },
});
const d = await r.json();
console.log(JSON.stringify({ code: d.code, isLogin: d.data?.isLogin, uname: d.data?.uname, mid: d.data?.mid }));
