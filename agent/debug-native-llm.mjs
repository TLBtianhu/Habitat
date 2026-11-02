import fs from 'node:fs';
import { OpenAIProvider, createLlmDecider } from './llm-provider.mjs';
import { NativeMcClient } from '../clients/mc-native.mjs';
import { loadMcpfabricToken } from '../clients/mcpfabric-token.mjs';
const client = new NativeMcClient({ token: loadMcpfabricToken() });
const cfg = JSON.parse(fs.readFileSync('/etc/habitat/llm.json', 'utf8'));
const provider = new OpenAIProvider({ baseUrl: cfg.baseUrl, model: cfg.model, apiKey: cfg.apiKey });
const decider = createLlmDecider(provider, { allowedVerbs: ['say', 'look', 'stop'] });
const obs = await client.obs();
const intent = await decider(obs);
console.log('intent:', JSON.stringify(intent, null, 2));
try { console.log('result:', await client.act(intent)); } catch (e) { console.log('act error:', e.message); }
process.exit(0);
