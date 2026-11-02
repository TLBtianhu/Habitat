/**
 * clips 后端：大肥鱼的"木偶动画"——每个表情一段带透明通道的 WebM。
 * 对应 character.json 的 renderer: "clips"。
 *
 * 策略：两层 video 交叉淡化；idle/talk 循环；情绪片段播一次后回落。
 * 驱动协议仍是 AvatarState（mouth 由 talk 片段本身承担）。
 */

export async function initClips(host, base, manifest) {
  const clips = manifest.clips;
  const moodMap = clips.moods || {};

  const mk = () => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.preload = 'auto';
    v.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
      'opacity:0;transition:opacity .16s linear;pointer-events:none';
    host.appendChild(v);
    return v;
  };

  const A = mk();
  const B = mk();
  let front = A;
  let back = B;
  let current = null;
  let mood = null;

  const url = (n) => base + n;

  function swap(name, loop) {
    current = name;
    back.src = url(name);
    back.loop = loop;
    back.currentTime = 0;
    const p = back.play();
    if (p) p.catch(() => {});
    back.style.opacity = '1';
    front.style.opacity = '0';
    const old = front;
    front = back;
    back = old;
    setTimeout(() => { try { old.pause(); } catch {} }, 220);
  }

  function idleClip(talk) {
    return talk ? clips.talk : clips.idle;
  }

  async function toIdle(talk) {
    mood = null;
    swap(idleClip(talk), true);
  }

  function playMood(name) {
    const file = moodMap[name];
    if (!file) return false;
    mood = name;
    swap(file, false);
    return true;
  }

  front.addEventListener('ended', () => { if (mood) toIdle(state.talk); });

  const state = { expr: 'idle', talk: false };

  // 起播
  swap(clips.idle, true);

  // 自动播放策略兜底：首次点击/触摸后重试
  const kick = () => { if (front.paused) front.play().catch(() => {}); document.removeEventListener('pointerdown', kick); };
  document.addEventListener('pointerdown', kick);

  return {
    id: 'clips',
    async load() {},
    tick() {},
    setExpression(n) {
      state.expr = n;
      const map = { happy: 'laugh', shy: 'shy', shocked: 'shocked', think: 'think', sad: 'sad', idle: null };
      const m = map[n];
      if (m && playMood(m)) return;
      if (mood) toIdle(state.talk);
    },
    setMouth() {},
    setTalk(v) {
      state.talk = !!v;
      if (mood) return;            // 情绪片段播完再回落
      if (current !== idleClip(state.talk)) swap(idleClip(state.talk), true);
    },
    setGaze() {},
    dispose() { try { A.remove(); B.remove(); } catch {} },
    _debug: () => ({ ...state, current, mood }),
  };
}
