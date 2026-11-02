// LLM provider：OpenAI-compatible + mock，输出只能是闭集 intent
export class OpenAIProvider {
  constructor({ baseUrl, model, apiKey, timeoutMs = 30000, maxTokens = 300, temperature = 0.3 }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
  }

  async complete({ system, user }) {
    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

export class MockProvider {
  constructor(outputs = []) { this.outputs = [...outputs]; this.calls = []; }
  async complete({ system, user }) {
    this.calls.push({ system, user });
    if (!this.outputs.length) throw new Error('mock exhausted');
    return this.outputs.shift();
  }
}

export function createLlmDecider(provider, { allowedVerbs = ['walk', 'dig', 'say'], instructions = '' } = {}) {
  return async function decide(obs) {
    const system = `你是一个 AI 客户端的决策器。只能返回 JSON：{"verb":"${allowedVerbs.join('|')}","args":{...}}，不许返回其他文字。${instructions}`;
    const user = JSON.stringify({ obs, allowedVerbs });
    const text = await provider.complete({ system, user });
    let intent;
    try { intent = JSON.parse(text); } catch { throw new Error('LLM 输出不是 JSON'); }
    if (!intent || !allowedVerbs.includes(intent.verb)) {
      throw new Error('LLM 输出动词不在白名单: ' + intent?.verb);
    }
    const args = intent.args || {};
    // 归一化模型常用别名，避免各家模型参数名漂移
    if (intent.verb === 'dig') {
      if (args.target == null && args.block != null) args.target = args.block;
      if (args.n == null && args.count != null) args.n = args.count;
    }
    if (['say', 'system.say', 'mc.say'].includes(intent.verb) && args.text == null && args.message != null) args.text = args.message;
    if (intent.verb === 'look') {
      const p = Array.isArray(args.target) ? args.target : Array.isArray(args.pos) ? args.pos : null;
      if (p) { args.x ??= p[0]; args.y ??= p[1]; args.z ??= p[2]; }
    }
    return { verb: intent.verb, args };
  };
}
