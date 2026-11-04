import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Socks5Relay, connectSocks5 } from './socks5-relay.mjs';
import { RtmpNetworkPolicy } from './network-policy.mjs';
import { fetch as undiciFetch } from 'undici';

const root = path.join(process.cwd(), '.tmp', `network-policy-${process.pid}`);
const previousHttpsProxy = process.env.HTTPS_PROXY;
fs.mkdirSync(root, { recursive: true });
const destination = net.createServer((socket) => {
  socket.write('hello');
  socket.on('data', (chunk) => socket.write(chunk));
});
await new Promise((resolve) => destination.listen(0, '127.0.0.1', resolve));
const destinationPort = destination.address().port;
const proxy = net.createServer((socket) => {
  let stage = 0;
  socket.on('data', (chunk) => {
    if (stage === 0) {
      stage = 1;
      socket.write(Buffer.from([5, 0]));
      return;
    }
    if (stage === 1) {
      stage = 2;
      const hostLength = chunk[4];
      const host = chunk.subarray(5, 5 + hostLength).toString();
      const port = chunk.readUInt16BE(5 + hostLength);
      const upstream = net.connect({ host, port }, () => {
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
    }
  });
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const proxyPort = proxy.address().port;
const apiProxy = net.createServer((socket) => {
  socket.once('data', (chunk) => {
    if (!chunk.toString().startsWith('CONNECT')) {
      socket.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{"ok":true}');
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => {
      socket.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{"ok":true}');
    });
  });
});
await new Promise((resolve) => apiProxy.listen(0, '127.0.0.1', resolve));
const apiProxyPort = apiProxy.address().port;
const readHello = (socket) => new Promise((resolve, reject) => {
  socket.once('data', (chunk) => resolve(chunk.toString()));
  socket.once('error', reject);
  socket.setTimeout(3000, () => reject(new Error('read timeout')));
});
let route;
try {
  const direct = await connectSocks5({ proxyHost: '127.0.0.1', proxyPort, destinationHost: '127.0.0.1', destinationPort });
  assert.equal(direct.leftover.length ? direct.leftover.toString() : await readHello(direct.socket), 'hello');
  direct.socket.destroy();

  const file = path.join(root, 'stream-network.json');
  const policy = new RtmpNetworkPolicy({ file });
  policy.save({ mode: 'socks5', proxy: { host: '127.0.0.1', port: proxyPort } });
  const target = `rtmp://127.0.0.1:${destinationPort}/live-bvc/?streamname=test`;
  route = await policy.route(target);
  assert.ok(route.target.includes('127.0.0.1:'));
  assert.equal(route.tcUrl, target);
  const socket = net.connect({ host: '127.0.0.1', port: new URL(route.target).port });
  assert.equal(await readHello(socket), 'hello');
  socket.destroy();
  await route.close();
  const checked = await policy.check(target);
  assert.equal(checked.lastResult, 'reachable');
  assert.equal(checked.lastError, null);
  assert.equal(checked.proxyConfigured, true);
  assert.equal(checked.supported, true);
  assert.ok(!JSON.stringify(checked).includes('password'));

  const systemPolicy = new RtmpNetworkPolicy({ file: path.join(root, 'system-network.json') });
  systemPolicy.save({ mode: 'system', allowSystemProxyForRtmp: false });
  assert.equal(systemPolicy.status().supported, false);
  await assert.rejects(systemPolicy.route(target), /system proxy for RTMP is disabled/);
  systemPolicy.save({ mode: 'system', allowSystemProxyForRtmp: true });
  assert.equal(systemPolicy.status().supported, true);

  process.env.HTTPS_PROXY = `http://127.0.0.1:${apiProxyPort}`;
  const dispatcher = policy.apiDispatcher();
  const response = await undiciFetch('http://example.test/api', { dispatcher });
  assert.equal((await response.json()).ok, true);
  await dispatcher.close();
  console.log('ok: SOCKS5 实际转发、RTMP 路由预检、HTTP API 代理与秘密不回显');
} finally {
  if (route) await route.close().catch(() => {});
  destination.close();
  proxy.close();
  apiProxy.close();
  if (previousHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
  else process.env.HTTPS_PROXY = previousHttpsProxy;
  fs.rmSync(root, { recursive: true, force: true });
}
