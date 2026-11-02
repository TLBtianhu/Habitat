// Voice Client：读取音色库；只有 voice.speak 才创建语音 Utterance。
import fs from 'node:fs';

export class VoiceClient {
  constructor({ baseUrl = 'http://127.0.0.1:9270', tokenPath = process.env.HABITAT_AGENT_TOKEN_FILE || '/etc/habitat/agent.token' } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = fs.readFileSync(tokenPath, 'utf8').trim();
  }

  async profiles() {
    const r = await fetch(`${this.baseUrl}/profiles`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`voice profiles HTTP ${r.status}`);
    return r.json();
  }

  async speak({ text = null, messageId = null, voiceProfile = null, delivery = ['console'], priority = 'normal', source = 'system' }) {
    const r = await fetch(`${this.baseUrl}/utterances`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ text, messageId, voiceProfile, delivery, priority, source }),
      signal: AbortSignal.timeout(7000),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `voice HTTP ${r.status}`);
    return data;
  }

  async getUtterance(id) {
    const r = await fetch(`${this.baseUrl}/utterances/${Number(id)}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`voice utterance HTTP ${r.status}`);
    return r.json();
  }
}
