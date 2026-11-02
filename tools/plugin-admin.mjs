// Owner-only plugin lifecycle operations via Control API.
import fs from 'node:fs';

const [action, id] = process.argv.slice(2);
if (!['disable', 'enable', 'revoke', 'unrevoke', 'uninstall'].includes(action) || !id) {
  throw new Error('用法: node tools/plugin-admin.mjs <disable|enable|revoke|unrevoke|uninstall> <plugin-id>');
}
const token = fs.readFileSync(process.env.HABITAT_OWNER_TOKEN_FILE || '/etc/habitat/owner.token', 'utf8').trim();
const response = await fetch((process.env.HABITAT_CONTROL_URL || 'http://127.0.0.1:9240') + `/plugins/${action}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ id }),
  signal: AbortSignal.timeout(10000),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error || `plugin ${action} failed`);
console.log(JSON.stringify(result, null, 2));
