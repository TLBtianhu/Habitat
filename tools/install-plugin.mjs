// 通过 Control API 由主人安装签名插件；不绕过 Control 的 owner 校验。
import fs from 'node:fs';

const id = process.argv[2];
if (!id) throw new Error('用法: node tools/install-plugin.mjs <plugin-id>');
const ownerFile = process.env.HABITAT_OWNER_TOKEN_FILE || '/etc/habitat/owner.token';
const token = fs.readFileSync(ownerFile, 'utf8').trim();
const control = process.env.HABITAT_CONTROL_URL || 'http://127.0.0.1:9240';
const response = await fetch(control + '/plugins/install', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ id }),
  signal: AbortSignal.timeout(30000),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error || `plugin install failed: ${response.status}`);
console.log(JSON.stringify(result, null, 2));
