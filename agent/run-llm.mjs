// 真实 LLM 连通性测试：读取 /etc/habitat/llm.env，不打印密钥
import fs from 'node:fs';
import { OpenAIProvider, createLlmDecider } from './llm-provider.mjs';

function readEnv(path) {
  const out = {};
  try {
    for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}

const env = readEnv('/etc/habitat/llm.env');
const cfg = JSON.parse(fs.readFileSync('/etc/habitat/llm.json', 'utf8'));
const apiKey = cfg.apiKey || env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error('未在 /etc/habitat/llm.json 配置 apiKey');

const provider = new OpenAIProvider({ ...cfg, apiKey });
const decide = createLlmDecider(provider);

const intent = await decide({
  self: { health: 20, pos: [0, 68, 0] },
  action: { isIdle: true },
  nearby: { blocks: [{ name: 'oak_log', n: 4, nearest: 3.2 }] },
});
console.log('LLM intent:', JSON.stringify(intent));
process.exit(0);
