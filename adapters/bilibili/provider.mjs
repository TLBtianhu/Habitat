// B站应用运行时：只读弹幕连接与重连监督，不创建公网推送。
import fs from 'node:fs';
import { BiliConnectionSupervisor } from '../../clients/bilibili-supervisor.mjs';

function loadCookie(env) {
  if (env.HABITAT_BILIBILI_COOKIE) return env.HABITAT_BILIBILI_COOKIE;
  const cookieFile = env.HABITAT_BILIBILI_COOKIE_FILE || '/etc/habitat/bilibili-cookies.txt';
  const configFile = env.HABITAT_BILIBILI_CONFIG || '/etc/habitat/bilibili.json';
  if (fs.existsSync(cookieFile)) return fs.readFileSync(cookieFile, 'utf8').trim();
  if (fs.existsSync(configFile)) {
    return `SESSDATA=${JSON.parse(fs.readFileSync(configFile, 'utf8')).sessdata}`;
  }
  return '';
}

export function createRuntime({ env = process.env, bilibiliSupervisorFactory = null } = {}) {
  const roomId = Number(env.HABITAT_BILIBILI_ROOM_ID || 0);
  const listeners = new Set();
  const supervisor = roomId
    ? (bilibiliSupervisorFactory || ((options) => new BiliConnectionSupervisor(options)))({
      roomId,
      cookie: loadCookie(env),
      onEvent: (event) => { for (const listener of listeners) listener(event); },
    })
    : null;
  return {
    async start() { await supervisor?.start(); },
    async stop() { await supervisor?.stop(); },
    status() { return supervisor ? { ...supervisor.status(), enabled: true } : { state: 'disabled', enabled: false, roomId: 0, lastError: null }; },
    obs() { return supervisor?.obs() || { available: false, state: 'disabled', recent: [], new: [] }; },
    complete(ids) { supervisor?.complete(ids); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    roomId,
  };
}

export function createHandlers() { return {}; }
