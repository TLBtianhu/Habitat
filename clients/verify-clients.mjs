// QQ/B站客户端验收：Mock OneBot 与 B站 API，验证登录、发送与读取
import assert from 'node:assert/strict';
import http from 'node:http';
import { OneBotClient } from './onebot.mjs';
import { BilibiliClient } from './bilibili.mjs';

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/get_login_info') return res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 123, nickname: 'Dafeiyu' } }));
  if (url.pathname === '/send_group_msg' || url.pathname === '/send_private_msg') return res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 1 } }));
  if (url.pathname === '/x/web-interface/view') return res.end(JSON.stringify({ code: 0, data: { title: '大肥鱼的一天', bvid: 'BV1xx411c7XX' } }));
  if (url.pathname === '/room/v1/Room/get_info') return res.end(JSON.stringify({ code: 0, data: { room_id: 999, title: '大肥鱼直播间' } }));
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => server.listen(19099, '127.0.0.1', r));
const base = 'http://127.0.0.1:19099';

console.log('[1] OneBot 登录与发送');
const qq = new OneBotClient({ httpUrl: base, accessToken: 't' });
const info = await qq.getLoginInfo();
assert.equal(info.nickname, 'Dafeiyu');
const sent = await qq.sendGroupMsg(10001, '大家好');
assert.equal(sent.message_id, 1);
console.log('  ok');

console.log('[2] B 站视频与直播间信息');
const b = new BilibiliClient({ apiBase: base, liveApiBase: base });
const v = await b.getVideoInfo('BV1xx411c7XX');
assert.equal(v.title, '大肥鱼的一天');
const room = await b.getRoomInfo(999);
assert.equal(room.title, '大肥鱼直播间');
console.log('  ok');

server.closeAllConnections?.();
await new Promise((r) => setTimeout(r, 100));
await new Promise((r) => server.close(r));
console.log('QQ/B站客户端验收通过');
process.exit(0);
