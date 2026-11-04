import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AuthFlowController } from './auth-flow.mjs';

const root = path.join(process.cwd(), '.tmp', `auth-flow-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
const tokenFile = path.join(root, 'napcat.token');
fs.writeFileSync(tokenFile, 'test-token', { mode: 0o600 });
const calls = [];
const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
const controller = new AuthFlowController({
  tokenFile,
  fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ data: { Credential: 'credential-test' } }));
    if (url.endsWith('/QQLogin/CheckLoginStatus')) return new Response(JSON.stringify({ data: false }));
    if (url.endsWith('/QQLogin/RefreshQRcode')) return new Response(JSON.stringify({ data: { qrcodeurl: `data:image/png;base64,${png}` } }));
    throw new Error(`unexpected ${url}`);
  },
});
try {
  const refreshed = await controller.refresh();
  assert.equal(refreshed.state, 'awaiting_scan');
  assert.equal(refreshed.image.data, png);
  assert.equal(refreshed.image.mimeType, 'image/png');
  assert.equal(calls.filter((call) => call.url.endsWith('/auth/login')).length, 2);
  assert.equal(calls.some((call) => call.options.body?.includes('test-token')), false);
  const ready = new AuthFlowController({
    tokenFile,
    fetchImpl: async (url) => {
      if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ data: { Credential: 'credential-test' } }));
      if (url.endsWith('/QQLogin/CheckLoginStatus')) return new Response(JSON.stringify({ data: true }));
      throw new Error(`unexpected ${url}`);
    },
  });
  assert.equal((await ready.refresh()).state, 'ready');
  assert.equal((await ready.refresh()).image, null);
  console.log('ok: 统一认证刷新、凭证交换、当前二维码状态与秘密不泄露');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
