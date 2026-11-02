// 解析 Outlet 的真实入口；已安装插件必须留在自己的目录边界内。
import fs from 'node:fs';
import path from 'node:path';
import { validateManifest } from '../adapters/plugin-manifest.mjs';

export function resolveOutlet({ name, root, entries, pluginInstaller, testNode = false, testFile = '' }) {
  if (testNode) return { script: testFile, cwd: path.join(root, '..'), node: true, source: 'test' };
  if (name === 'hls') {
    const installed = pluginInstaller.installed().find((item) => item.id === 'hls');
    if (installed) {
      if (!installed.enabled || installed.revoked) throw new Error('outlet disabled or revoked: hls');
      const appRoot = path.join(pluginInstaller.cacheDir, 'installed', 'hls');
      const manifestPath = path.join(appRoot, 'adapters', 'hls', 'manifest.json');
      const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath);
      const script = path.resolve(path.dirname(manifestPath), manifest.entry);
      const normalizedRoot = path.resolve(appRoot);
      const normalizedScript = path.resolve(script);
      const comparableRoot = process.platform === 'win32' ? normalizedRoot.toLowerCase() : normalizedRoot;
      const comparableScript = process.platform === 'win32' ? normalizedScript.toLowerCase() : normalizedScript;
      if (!comparableScript.startsWith(comparableRoot + path.sep)) throw new Error('outlet entry escapes plugin directory');
      const stat = fs.lstatSync(script);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('outlet entry must be a regular file');
      return { script, cwd: appRoot, node: false, source: 'installed', version: installed.version };
    }
  }
  return { script: path.join(root, entries[name]), cwd: path.join(root, '..'), node: false, source: 'builtin' };
}
