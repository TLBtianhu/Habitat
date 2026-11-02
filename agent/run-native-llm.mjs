// LLM 驱动原生 MC 客户端：obs → DeepSeek → mcpfabric 动作
import fs from 'node:fs';
import { AgentLoop } from './agent-loop.mjs';
import { OpenAIProvider, createLlmDecider } from './llm-provider.mjs';
import { NativeMcClient } from '../clients/mc-native.mjs';
import { loadMcpfabricToken } from '../clients/mcpfabric-token.mjs';

const client = new NativeMcClient({ token: loadMcpfabricToken() });
const broker = { call: (verb, args) => client.act({ verb, args }) };
const cfg = JSON.parse(fs.readFileSync('/etc/habitat/llm.json', 'utf8'));
const provider = new OpenAIProvider({ baseUrl: cfg.baseUrl, model: cfg.model, apiKey: cfg.apiKey });
const decider = createLlmDecider(provider, { allowedVerbs: ['say', 'look', 'stop'] });
const loop = new AgentLoop({ broker, decider });

const obs = await client.obs();
console.log('obs:', JSON.stringify(obs).slice(0, 400));
const r = await loop.tick(obs);
console.log('result:', JSON.stringify(r, null, 2));
process.exit(0);
