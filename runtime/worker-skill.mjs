// 技能 Worker：只负责加载 artifact 并执行，能力调用一律回 broker
// 它不能写命令日志、不能自己联网、不能读宿主文件。
import { parentPort } from 'node:worker_threads';

const port = parentPort;
let mod = null;
let ctx = null;

function fail(id, error) {
  port.postMessage({ type: 'result', id, ok: false, error: String(error?.message || error) });
}

port.on('message', async (msg) => {
  if (msg.type === 'init') {
    try {
      const artifact = msg.artifact;
      if (!artifact.manifest?.id || !artifact.manifest.version || !artifact.manifest.entry) {
        throw new Error('manifest 缺 id/version/entry');
      }
      const moduleObj = { exports: {} };
      const fn = new Function('module', 'exports', 'require', 'ctx', artifact.code);
      fn(moduleObj, moduleObj.exports, () => { throw new Error('worker 内禁止 require'); }, ctx);
      mod = moduleObj.exports;
      if (typeof mod.call !== 'function') throw new Error('artifact 必须导出 call(capability,args,ctx)');
      ctx = msg.state || {};
      if (typeof mod.init === 'function') await mod.init(ctx);
      port.postMessage({ type: 'ready', ok: true, manifest: mod.manifest || artifact.manifest });
    } catch (e) {
      port.postMessage({ type: 'ready', ok: false, error: String(e.message || e) });
    }
    return;
  }

  if (msg.type === 'call') {
    if (msg.capability === '__crash') process.exit(1);   // 故障注入用
    if (!mod) return fail(msg.id, 'not initialized');
    try {
      const value = await mod.call(msg.capability, msg.args, ctx);
      port.postMessage({ type: 'result', id: msg.id, ok: true, value });
    } catch (e) { fail(msg.id, e); }
    return;
  }

  if (msg.type === 'shutdown') {
    if (typeof mod?.dispose === 'function') {
      try { await mod.dispose(ctx); } catch {}
    }
    port.postMessage({ type: 'bye' });
    process.exit(0);
  }
});
