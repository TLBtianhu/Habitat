const url = 'https://passport.biligame.com/x/passport-login/web/crossDomain?ticket=93706d4bdf0c0699282306ab0885321a&gourl=https%3A%2F%2Fwww.bilibili.com&first_domain=.bilibili.com';
const r = await fetch(url, { redirect: 'manual', headers: { cookie: 'buvid3=habitat-demo' } });
console.log('status', r.status);
console.log('set-cookie:', r.headers.get('set-cookie'));
console.log('location:', r.headers.get('location'));
console.log((await r.text()).slice(0, 500));
