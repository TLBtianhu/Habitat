const key = '1156c9e9f2002b9d8356729f3f18d1c0';
const r = await fetch(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${key}&from=web`, {
  headers: {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    referer: 'https://www.bilibili.com/',
  },
});
console.log('set-cookie:', r.headers.get('set-cookie'));
console.log(JSON.stringify(await r.json(), null, 2).slice(0, 2000));
