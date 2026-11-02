/**
 * 形象适配层：引擎可换，驱动协议不变。
 *
 * 驱动协议（AvatarState）——这是 fishbowl 自己的规范，与具体引擎无关：
 *   { expr: string, mouth: 0..1, gaze: {x:-1..1,y:-1..1}, talk: boolean, pose?: string }
 *
 * 后端：
 *   - sprite  ：CC0 占位角色（内联 SVG，零依赖，默认）
 *   - live2d  ：Cubism 4（需用户自带模型 + Live2D Cubism Core，专有许可）
 *   - vrm     ：three-vrm（PR 待做）
 */

const AVATAR_STATE = {
  expr: 'idle',
  mouth: 0,
  gaze: { x: 0, y: 0 },
  talk: false,
  pose: '',
};

const EXPR_STYLE = {
  idle:    { blush: 0.35, mouthH: 1.0, brow: 0 },
  happy:   { blush: 0.55, mouthH: 1.25, brow: -2 },
  shy:     { blush: 0.85, mouthH: 0.8, brow: 2 },
  shocked: { blush: 0.25, mouthH: 1.5, brow: -6 },
  think:   { blush: 0.2, mouthH: 0.6, brow: 4 },
  sad:     { blush: 0.3, mouthH: 0.55, brow: 6 },
};

function createSpriteAvatar(root) {
  const mouth = root.querySelector('.mouth');
  const blushL = root.querySelectorAll('.blush')[0];
  const blushR = root.querySelectorAll('.blush')[1];
  const eyes = root.querySelectorAll('.eye');
  let t0 = performance.now();

  function apply(state) {
    const s = EXPR_STYLE[state.expr] || EXPR_STYLE.idle;
    const talking = state.talk && state.mouth > 0.02;
    const scale = talking ? s.mouthH * (0.45 + state.mouth * 1.1) : s.mouthH;
    if (mouth) mouth.style.transform = `scaleY(${scale.toFixed(3)})`;
    for (const b of [blushL, blushR]) {
      if (b) b.style.opacity = String(s.blush);
    }
    if (eyes[0] && eyes[1]) {
      const gx = state.gaze.x * 2.2;
      const gy = state.gaze.y * 1.6;
      eyes[0].style.transform = `translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px)`;
      eyes[1].style.transform = `translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px)`;
    }
  }

  return {
    id: 'sprite',
    load: async () => {},
    tick(_dt, state) { apply(state); },
    setExpression(name) { state.expr = EXPR_STYLE[name] ? name : 'idle'; },
    setMouth(v) { state.mouth = Math.max(0, Math.min(1, v)); },
    setTalk(v) { state.talk = !!v; },
    setGaze(x, y) { state.gaze = { x, y }; },
    dispose() {},
    _debug: () => ({ ...state }),
  };
}

function createLive2DAvatar(modelUrl) {
  return {
    id: 'live2d',
    async load() {
      // 运行时不在本仓库分发：Cubism Core 是专有许可，必须由使用者确认后加载
      if (!window.PIXI || !window.Live2D) {
        throw new Error(
          'live2d 后端需要先加载 PIXI.js + Live2D Cubism Core + pixi-live2d-display。' +
          '见 assets-packs/whale-girl/NOTICE.md（非商业、需署名）。'
        );
      }
      throw new Error('live2d 后端尚未接线：' + modelUrl);
    },
    tick() {},
    setExpression() {},
    setMouth() {},
    setTalk() {},
    setGaze() {},
    dispose() {},
  };
}

const Avatar = (() => {
  let backend = null;
  return {
    async use(b) { backend = b; await backend.load(); },
    tick(dt) {
      if (!backend) return;
      backend.tick(dt, AVATAR_STATE);
    },
    setExpression(n) { if (backend) { AVATAR_STATE.expr = n; backend.setExpression(n); } },
    setMouth(v) { if (backend) { AVATAR_STATE.mouth = v; backend.setMouth(v); } },
    setTalk(v) { if (backend) { AVATAR_STATE.talk = v; backend.setTalk(v); } },
    setGaze(x, y) { if (backend) backend.setGaze(x, y); },
    state: () => ({ ...AVATAR_STATE }),
    createSpriteAvatar,
    createLive2DAvatar,
  };
})();

window.Avatar = Avatar;
