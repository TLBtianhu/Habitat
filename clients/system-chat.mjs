// Core 系统对话通道：只连接控制台，不经过 MC、QQ、B 站或任何应用。
import fs from 'node:fs';
import path from 'node:path';

export class SystemChatClient {
  constructor({
    baseUrl = process.env.HABITAT_CONTROL_URL || 'http://127.0.0.1:9240',
    actor = 'dafeiyu',
    tokenPath = process.env.HABITAT_AGENT_TOKEN_FILE || '/etc/habitat/agent.token',
    watermarkPath = process.env.HABITAT_SYSTEM_CHAT_WATERMARK || '/var/lib/habitat/agent-system-chat.json',
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.actor = actor;
    this.token = fs.readFileSync(tokenPath, 'utf8').trim();
    this.watermarkPath = watermarkPath;
    this.lastSeenId = 0;
    this.hasWatermark = false;
    try {
      const saved = JSON.parse(fs.readFileSync(watermarkPath, 'utf8'));
      if (Number.isSafeInteger(saved.lastSeenId) && saved.lastSeenId >= 0) {
        this.lastSeenId = saved.lastSeenId;
        this.hasWatermark = true;
      }
    } catch {}
  }

  saveWatermark() {
    fs.mkdirSync(path.dirname(this.watermarkPath), { recursive: true });
    const tmp = `${this.watermarkPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ lastSeenId: this.lastSeenId }));
    fs.renameSync(tmp, this.watermarkPath);
  }

  async list() {
    const r = await fetch(`${this.baseUrl}/system/chat`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`system.chat HTTP ${r.status}`);
    return r.json();
  }

  async init() {
    const messages = await this.list();
    const maxId = messages.reduce((max, m) => Math.max(max, m.id), 0);
    if (!this.hasWatermark || maxId < this.lastSeenId) this.lastSeenId = maxId;
    this.hasWatermark = true;
    this.saveWatermark();
    return messages;
  }

  async obs() {
    const messages = await this.list();
    const clean = (m) => ({ id: m.id, from: m.from, text: m.text, at: m.at });
    const maxId = messages.reduce((max, m) => Math.max(max, m.id), 0);
    if (maxId < this.lastSeenId) {
      // 控制面重置后从新的水位开始，不把重置前的消息误当新输入。
      this.lastSeenId = maxId;
      this.saveWatermark();
      return { channel: 'system', recent: messages.slice(-12).map(clean), new: [] };
    }
    const fresh = messages.filter((m) => m.id > this.lastSeenId && m.from !== this.actor);
    const previous = this.lastSeenId;
    this.lastSeenId = Math.max(maxId, this.lastSeenId);
    if (this.lastSeenId !== previous) this.saveWatermark();
    return {
      channel: 'system',
      recent: messages.slice(-12).map(clean),
      new: fresh.map(clean),
    };
  }

  async say(text) {
    const r = await fetch(`${this.baseUrl}/system/chat/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ text: String(text || '').slice(0, 300) }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `system.say HTTP ${r.status}`);
    this.lastSeenId = Math.max(this.lastSeenId, data.id);
    this.saveWatermark();
    return data;
  }
}
