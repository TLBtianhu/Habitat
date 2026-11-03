// B 站扫码登录 provider：生成二维码、轮询状态、写入本机受保护配置
import fs from 'node:fs';
import QRCode from 'qrcode';

const GENERATE = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main_web&web_location=333.1228';
const POLL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';

export async function begin() {
  const r = await fetch(GENERATE, { signal: AbortSignal.timeout(15000) });
  const data = await r.json();
  if (data.code !== 0) throw new Error(data.message || 'qr generate failed');
  const url = data.data.url;
  return {
    flow: 'qrcode',
    qrcodeKey: data.data.qrcode_key,
    url,
    qrDataUrl: await QRCode.toDataURL(url),
    // 前端可用任意二维码库把 url 渲染成二维码
    instruction: '用 B 站 App 扫码并确认登录',
  };
}

export async function poll(qrcodeKey) {
  const r = await fetch(`${POLL}?qrcode_key=${encodeURIComponent(qrcodeKey)}&source=main_web&web_location=333.1228`, { signal: AbortSignal.timeout(15000) });
  const data = await r.json();
  if (data.code !== 0) return { status: 'error', message: data.message };
  const d = data.data;
  if (d.code === 0) {
    console.error('bilibili poll success payload:', JSON.stringify(d));
    const cookies = d.cookie_info?.cookies || [];
    const sess = cookies.find((c) => c.name === 'SESSDATA');
    if (sess) return { status: 'bound', sessdata: sess.value, displayName: 'B 站账号' };
    if (d.url) {
      return { status: 'ticket', url: d.url, displayName: 'B 站账号' };
    }
    return { status: 'error', message: '登录成功但未取得 SESSDATA' };
  }
  if (d.code === 86090) return { status: 'scanned', message: '已扫码，请在手机上确认' };
  if (d.code === 86101) return { status: 'waiting', message: '等待扫码' };
  if (d.code === 86038) return { status: 'expired', message: '二维码已过期' };
  return { status: 'waiting', message: d.message || '等待中' };
}

export function writeConfig({ sessdata }) {
  const cfg = { provider: 'bilibili', sessdata, scopes: ['live.read', 'live.write', 'live.push'] };
  const file = process.env.HABITAT_BILIBILI_CONFIG || '/etc/habitat/bilibili.json';
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chownSync(file, 1000, 1000); } catch {}
  return { written: file };
}
