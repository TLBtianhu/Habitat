// 根目录内的 SOCKS5 RTMP 转发：只监听回环，不改系统代理、路由或防火墙。
import net from 'node:net';

function readExact(socket, state, length, timeoutMs) {
  state.buffer = state.buffer || Buffer.alloc(0);
  if (state.buffer.length >= length) {
    const result = state.buffer.subarray(0, length);
    state.buffer = state.buffer.subarray(length);
    return Promise.resolve(result);
  }
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      state.buffer = Buffer.concat([state.buffer, chunk]);
      if (state.buffer.length >= length) {
        const result = state.buffer.subarray(0, length);
        state.buffer = state.buffer.subarray(length);
        cleanup();
        resolve(result);
      }
    };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('SOCKS5 connection closed')); };
    const onTimeout = () => { cleanup(); reject(new Error(`SOCKS5 timeout: expected ${length} bytes, received ${state.buffer.length}`)); };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      socket.off('timeout', onTimeout);
    };
    state.buffer = state.buffer || Buffer.alloc(0);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.once('timeout', onTimeout);
    socket.setTimeout(timeoutMs);
  });
}

export async function connectSocks5({ proxyHost, proxyPort, destinationHost, destinationPort, username = '', password = '', timeoutMs = 8000 }) {
  const socket = net.connect({ host: proxyHost, port: proxyPort });
  const state = { buffer: Buffer.alloc(0) };
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      socket.setTimeout(timeoutMs, () => reject(new Error('SOCKS5 connect timeout')));
    });
    const methods = username ? [0, 2] : [0];
    socket.write(Buffer.from([5, methods.length, ...methods]));
    const method = await readExact(socket, state, 2, timeoutMs);
    if (method[0] !== 5 || (username ? method[1] !== 2 : method[1] !== 0)) throw new Error('SOCKS5 authentication negotiation failed');
    if (username) {
      const user = Buffer.from(username);
      const pass = Buffer.from(password);
      if (user.length > 255 || pass.length > 255) throw new Error('SOCKS5 credentials too long');
      socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
      const auth = await readExact(socket, state, 2, timeoutMs);
      if (auth[1] !== 0) throw new Error('SOCKS5 authentication failed');
    }
    const host = Buffer.from(destinationHost);
    if (host.length > 255) throw new Error('destination host too long');
    const request = Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, Buffer.from([(destinationPort >> 8) & 255, destinationPort & 255])]);
    socket.write(request);
    const header = await readExact(socket, state, 4, timeoutMs);
    if (header[1] !== 0) throw new Error(`SOCKS5 connect failed (${header[1]})`);
    let remaining = 0;
    if (header[3] === 1) remaining = 4 + 2;
    else if (header[3] === 3) {
      const length = (await readExact(socket, state, 1, timeoutMs))[0];
      remaining = length + 2;
    } else if (header[3] === 4) remaining = 16 + 2;
    else throw new Error('SOCKS5 invalid address type');
    if (remaining) await readExact(socket, state, remaining, timeoutMs);
    socket.setTimeout(0);
    return { socket, leftover: state.buffer };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

export class Socks5Relay {
  constructor({ proxyHost, proxyPort, destinationHost, destinationPort, username = '', password = '', host = '127.0.0.1', port = 0, timeoutMs = 8000 }) {
    this.proxy = { proxyHost, proxyPort, destinationHost, destinationPort, username, password, timeoutMs };
    this.host = host;
    this.port = port;
    this.server = null;
    this.connections = new Set();
  }

  async start() {
    if (this.server) return this.port;
    this.server = net.createServer((client) => {
      this.connections.add(client);
      client.on('close', () => this.connections.delete(client));
      connectSocks5(this.proxy).then(({ socket, leftover }) => {
        this.connections.add(socket);
        socket.on('close', () => this.connections.delete(socket));
        if (leftover.length) client.write(leftover);
        client.pipe(socket).pipe(client);
      }).catch(() => client.destroy());
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, resolve);
    });
    this.port = this.server.address().port;
    return this.port;
  }

  async stop() {
    for (const socket of this.connections) socket.destroy();
    this.connections.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}
