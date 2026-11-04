// 统一认证流程：刷新时重新读取后端事实，不继承旧二维码或旧登录状态。
import fs from 'node:fs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';

function responseData(data) {
  return data?.data ?? data;
}

export class AuthFlowController {
  constructor({ fetchImpl = fetch, tokenFile = process.env.HABITAT_NAPCAT_TOKEN_FILE || process.env.NAPCAT_TOKEN_FILE || '/opt/habitat/config/napcat.token', baseUrl = 'http://127.0.0.1:6099/api' } = {}) {
    this.fetch = fetchImpl;
    this.tokenFile = tokenFile;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  token() {
    return fs.readFileSync(this.tokenFile, 'utf8').trim();
  }

  async post(path, body = {}, credential = null) {
    const headers = { 'content-type': 'application/json' };
    if (credential) headers.authorization = `Bearer ${credential}`;
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || data?.msg || `auth HTTP ${response.status}`);
    return responseData(data);
  }

  async credential() {
    const token = this.token();
    const hash = crypto.createHash('sha256').update(`${token}.napcat`).digest('hex');
    const data = await this.post('/auth/login', { hash });
    const credential = data?.Credential;
    if (!credential) throw new Error('NapCat WebUI did not issue a credential');
    return credential;
  }

  async status() {
    const credential = await this.credential();
    const data = await this.post('/QQLogin/CheckLoginStatus', {}, credential);
    const loggedIn = data === true || data?.loggedIn === true || data?.online === true || data?.isLogin === true;
    return { provider: 'napcat', state: loggedIn ? 'ready' : 'auth_required', checkedAt: Date.now() };
  }

  async image(value) {
    if (value.startsWith('data:image/')) {
      const mimeType = value.slice(5, value.indexOf(';'));
      return { mimeType, data: value.slice(value.indexOf(',') + 1) };
    }
    if (/^https?:\/\//.test(value)) {
      const data = await QRCode.toDataURL(value, { type: 'image/png', margin: 1, width: 512, errorCorrectionLevel: 'M' });
      return { mimeType: 'image/png', data: data.slice(data.indexOf(',') + 1) };
    }
    return { mimeType: 'image/png', data: value };
  }

  async refresh() {
    const current = await this.status();
    if (current.state === 'ready') return { ...current, image: null };
    const credential = await this.credential();
    const data = await this.post('/QQLogin/RefreshQRcode', {}, credential);
    if (data?.restarting) return { provider: 'napcat', state: 'connecting', image: null, checkedAt: Date.now() };
    const qrcode = data?.qrcodeurl;
    if (!qrcode) throw new Error(data?.message || data?.msg || 'NapCat did not return a QR image');
    return { provider: 'napcat', state: 'awaiting_scan', image: await this.image(qrcode), checkedAt: Date.now() };
  }
}
