const refresh = '3be4dff51ceb4d1e6417e126578212b2';
for (const url of [
  `https://passport.bilibili.com/x/passport-login/web/cookie/refresh?refresh_token=${refresh}`,
  `https://passport.bilibili.com/x/passport-login/web/cookie/refresh?refresh_token=${refresh}&source=main_web`,
]) {
  const r = await fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) });
  console.log(url, r.status, r.headers.get('set-cookie'));
  console.log((await r.text()).slice(0, 300));
}
