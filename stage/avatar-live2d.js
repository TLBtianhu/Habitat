/**
 * Live2D 后端（Cubism 4）：把 AvatarState 映射到模型参数。
 *
 * 运行时来源：
 *   vendor/live2dcubismcore.min.js  Live2D 专有许可，**不进 git**
 *   vendor/pixi.min.js              MIT
 *   vendor/cubism4.min.js           MIT（pixi-live2d-display）
 */

const VENDOR = './vendor/';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('加载失败: ' + src));
    document.head.appendChild(s);
  });
}

async function loadRuntime() {
  if (!window.Live2DCubismCore) await loadScript(VENDOR + 'live2dcubismcore.min.js');
  if (!window.PIXI) await loadScript(VENDOR + 'pixi.min.js');
  if (!(window.PIXI && window.PIXI.live2d)) await loadScript(VENDOR + 'cubism4.min.js');
}

const EXPR = {
  idle:    { eye: 1.0, brow: 0.0, angle: 0.0, mouthForm: 0.15 },
  happy:   { eye: 0.75, brow: 0.6, angle: -1.5, mouthForm: 0.6 },
  shy:     { eye: 0.6, brow: -0.5, angle: 2.0, mouthForm: 0.2 },
  shocked: { eye: 1.15, brow: 1.0, angle: 0.0, mouthForm: -0.4 },
  think:   { eye: 0.9, brow: -0.2, angle: -2.0, mouthForm: 0.0 },
  sad:     { eye: 0.7, brow: -0.9, angle: 1.0, mouthForm: -0.2 },
};

export async function initLive2D(canvas, modelUrl) {
  await loadRuntime();

  const app = new PIXI.Application({
    view: canvas,
    width: canvas.clientWidth || 300,
    height: canvas.clientHeight || 360,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });

  const model = await PIXI.live2d.Live2DModel.from(modelUrl);
  app.stage.addChild(model);

  // 铺满画布：等比缩放到画布高度，底部对齐
  const scale = Math.min(app.renderer.width / model.width, app.renderer.height / model.height);
  model.scale.set(scale * 0.98);
  model.anchor.set(0.5, 1);
  model.position.set(app.renderer.width / 2, app.renderer.height);

  const state = { expr: 'idle', mouth: 0, talk: false, gaze: { x: 0, y: 0 } };
  let blink = 1;
  let nextBlink = performance.now() + 2500 + Math.random() * 2500;

  function set(id, v) {
    try {
      const cm = model.internalModel.coreModel;
      if (typeof cm.setParameterValueById === 'function') cm.setParameterValueById(id, v);
    } catch { /* 模型没有这个参数就跳过 */ }
  }

  app.ticker.add(() => {
    const now = performance.now();
    if (now > nextBlink) {
      blink = 0.05;
      nextBlink = now + 2600 + Math.random() * 2800;
      setTimeout(() => { blink = 1; }, 110);
    }
    const e = EXPR[state.expr] || EXPR.idle;
    const breathe = Math.sin(now / 1400) * 0.5;
    const sway = Math.sin(now / 2100) * 2.2;

    set('ParamEyeLOpen', e.eye * blink);
    set('ParamEyeROpen', e.eye * blink);
    set('ParamBrowLY', e.brow);
    set('ParamBrowRY', e.brow);
    set('ParamMouthOpenY', state.talk ? state.mouth : 0);
    set('ParamMouthForm', e.mouthForm);
    set('ParamAngleX', state.gaze.x * 22 + sway);
    set('ParamAngleY', state.gaze.y * 16 + breathe);
    set('ParamAngleZ', e.angle + breathe * 0.6);
    set('ParamBodyAngleZ', breathe * 0.5);
  });

  return {
    id: 'live2d',
    async load() {},
    tick() {},
    setExpression(n) { state.expr = EXPR[n] ? n : 'idle'; },
    setMouth(v) { state.mouth = v; },
    setTalk(v) { state.talk = !!v; },
    setGaze(x, y) { state.gaze = { x, y }; },
    dispose() { try { app.destroy(false); } catch {} },
    _debug: () => ({ ...state }),
    _model: model,
  };
}
