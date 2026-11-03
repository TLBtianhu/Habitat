// DeepSeek 凭证 provider：校验 key 并写本机受保护配置，不把 key 写进身份记录
import fs from 'node:fs';

export async function validate(fields) {
  const baseUrl = (fields.baseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const r = await fetch(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${fields.apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return { ok: false, error: `DeepSeek HTTP ${r.status}` };
  const data = await r.json().catch(() => ({}));
  return { ok: true, displayName: 'DeepSeek API', detail: `models=${(data.data || []).length}` };
}

export function writeConfig(fields) {
  const cfg = {
    provider: 'openai-compatible',
    baseUrl: fields.baseUrl || 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: fields.apiKey,
    timeoutMs: 30000,
    maxTokens: 300,
    temperature: 0.3,
  };
  const file = process.env.HABITAT_LLM_CONFIG || '/etc/habitat/llm.json';
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chownSync(file, 1000, 1000); } catch {}
  return { written: file };
}
