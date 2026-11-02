// 实玩驱动：AgentLoop 读 obs，决策后经 /cmd 驱动 MC bot
import { AgentLoop } from '../agent/agent-loop.mjs';

const broker = {
  calls: [],
  async call(verb, args) {
    this.calls.push({ verb, args });
    const r = await fetch('http://127.0.0.1:9225/cmd', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verb, args }),
    });
    return { ok: r.ok };
  },
};

const loop = new AgentLoop({ broker, minIntervalMs: 1500 });
const END = Date.now() + 30000;

while (Date.now() < END) {
  try {
    const obs = await (await fetch('http://127.0.0.1:9225/obs')).json();
    const r = await loop.tick(obs);
    if (r.acted) console.log('[play]', r.intent.verb, JSON.stringify(r.intent.args), r.result);
  } catch (e) {
    console.log('[play]', e.message);
  }
  await new Promise((r) => setTimeout(r, 1600));
}
console.log('done, calls =', broker.calls.length);
process.exit(0);
