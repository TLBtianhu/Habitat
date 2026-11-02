const key = 'a4142d2743924a688d4106622742525a';
const r = await fetch(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${key}`);
const data = await r.json();
console.log('set-cookie:', r.headers.get('set-cookie'));
console.log(JSON.stringify(data, null, 2).slice(0, 2000));
