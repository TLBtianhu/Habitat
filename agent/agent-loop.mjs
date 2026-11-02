// AgentLoop（窄）：observe → decide → act，只能经注入的 broker 发闭集动词
// 不含 pwsh / 文件系统 / computer-use；不持凭证；可跑在 WSL 沙箱里。
export class AgentLoop {
  constructor({ broker, phase = 'PLAY', now = () => Date.now(), decider = null, memory = null, initiative = null } = {}) {
    this.broker = broker;          // { call(verb, args): Promise<result> }
    this.phase = phase;
    this.now = now;
    this.decider = decider;        // 可选：LLM 决策器；缺省用规则脑
    this.memoryStore = memory;     // 可选：分层记忆
    this.initiative = initiative;  // 可选：安静时主动小事
    this.lastActionAt = -Infinity;
    this.minIntervalMs = 1200;
    this.memory = { lastGoal: null, lastSeenTree: null, said: [] };
  }

  setPhase(p) { this.phase = p; }

  canAct() {
    return this.phase === 'PLAY' && this.now() - this.lastActionAt >= this.minIntervalMs;
  }

  decide(obs) {
    if (this.phase !== 'PLAY') return null;
    const self = obs.self || {};
    if (typeof self.health === 'number' && self.health < 8) {
      return { verb: 'say', args: { text: '我先躲开一下，血量有点低。' } };
    }
    const nearby = obs.nearby?.blocks
      || (Array.isArray(obs.nearby) ? obs.nearby : Object.values(obs.nearby || {}));
    const tree = nearby.find((n) => /log|tree/i.test(n.name))
      || nearby.find((n) => /dirt|stone/i.test(n.name));
    if (obs.action?.isIdle && tree) {
      if (this.memory.approachPending) {
        this.memory.approachPending = false;
        return { verb: 'dig', args: { target: tree.name, n: 1 } };
      }
      this.memory.approachPending = true;
      this.memory.lastSeenTree = tree;
      return { verb: 'walk', args: { toward: tree.name, distance: tree.nearest } };
    }
    return null;
  }

  async tick(obs) {
    if (!this.canAct()) return { acted: false, reason: this.phase !== 'PLAY' ? 'wrong_phase' : 'rate_limit' };
    const intent = this.decider ? await this.decider(obs) : this.decide(obs)
      || (this.initiative ? this.initiative.next(obs, this.now()) : null);
    if (!intent) return { acted: false, reason: 'no_intent' };
    const result = await this.broker.call(intent.verb, intent.args);
    this.lastActionAt = this.now();
    this.memoryStore?.remember(`动作 ${intent.verb} ${JSON.stringify(intent.args)}`, { tags: ['action'], importance: 0.5, at: this.now() });
    return { acted: true, intent, result };
  }
}

export function createRuleBroker() {
  const calls = [];
  return {
    calls,
    async call(verb, args) {
      calls.push({ verb, args });
      return { ok: true };
    },
  };
}
