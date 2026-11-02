// Quiet-time initiative：低活动期自主做小事，但有节奏与额度
export class Initiative {
  constructor({ quietMs = 30000, dailyQuota = 6 } = {}) {
    this.quietMs = quietMs;
    this.dailyQuota = dailyQuota;
    this.lastActionAt = 0;
    this.day = new Date().toDateString();
    this.count = 0;
  }

  next(obs, now = Date.now()) {
    const today = new Date(now).toDateString();
    if (today !== this.day) { this.day = today; this.count = 0; }
    if (now - this.lastActionAt < this.quietMs) return null;
    if (this.count >= this.dailyQuota) return null;

    const blocks = obs.nearby?.blocks || [];
    const tree = blocks.find((b) => /log|wood/i.test(b.name));
    if (tree) {
      this.count += 1;
      this.lastActionAt = now;
      return { verb: 'dig', args: { target: tree.name, n: 1 }, why: 'quiet-initiative: 顺手补点木头' };
    }

    if (obs.action?.isIdle && blocks.length) {
      this.count += 1;
      this.lastActionAt = now;
      return { verb: 'walk', args: { toward: blocks[0].name, distance: blocks[0].nearest }, why: 'quiet-initiative: 附近看看' };
    }
    return null;
  }
}
