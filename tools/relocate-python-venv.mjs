// 将 Linux venv 的基础 Python、标准库和入口收口到 venv 单目录，并验证真实解释器路径。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || '');
if (!root || root === '/') throw new Error('usage: node tools/relocate-python-venv.mjs /path/to/venv');
const cfgFile = path.join(root, 'pyvenv.cfg');
if (!fs.existsSync(cfgFile)) throw new Error('pyvenv.cfg not found');
const cfg = Object.fromEntries(fs.readFileSync(cfgFile, 'utf8').split(/\r?\n/).filter((line) => line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));
const python = path.join(root, 'bin', 'python');
const sourcePython = fs.realpathSync(process.argv[3] || python);
const info = JSON.parse(execFileSync(sourcePython, ['-c', 'import sys,json,platform; print(json.dumps({"executable":sys.executable,"basePrefix":sys.base_prefix,"version":platform.python_version()}))'], { encoding: 'utf8' }));
const base = path.join(root, 'base');
const baseBin = path.join(base, 'bin');
const baseLib = path.join(base, 'lib');
const version = info.version.split('.').slice(0, 2).join('.');
const basePython = path.join(baseBin, `python${version}`);
if (fs.lstatSync(basePython, { throwIfNoEntry: false })?.isSymbolicLink()) fs.rmSync(basePython, { force: true });
if (!fs.existsSync(basePython)) {
  fs.mkdirSync(baseBin, { recursive: true });
  fs.mkdirSync(baseLib, { recursive: true });
  fs.cpSync(sourcePython, basePython);
  const stdlib = path.join(info.basePrefix, 'lib', `python${version}`);
  if (!fs.existsSync(stdlib)) throw new Error(`Python stdlib not found: ${stdlib}`);
  fs.cpSync(stdlib, path.join(baseLib, `python${version}`), { recursive: true });
  const ldd = execFileSync('ldd', [sourcePython], { encoding: 'utf8' });
  const match = ldd.match(/libpython[\d.]+(?:\.so[\d.]*)\s*=>\s*(\S+)/);
  if (match) fs.cpSync(match[1], path.join(baseLib, path.basename(match[1])));
}
for (const name of ['python', 'python3', `python${version}`]) {
  const target = path.join(baseBin, name);
  if (name !== `python${version}` && !fs.existsSync(target)) fs.symlinkSync(`python${version}`, target);
  const link = path.join(root, 'bin', name);
  if (fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.rmSync(link, { force: true });
  fs.symlinkSync(path.join('..', 'base', 'bin', `python${version}`), link);
}
const nextCfg = [
  `home = ${baseBin}`,
  'include-system-site-packages = false',
  `version = ${info.version}`,
  `executable = ${basePython}`,
  '',
];
fs.writeFileSync(cfgFile, nextCfg.join('\n'), { mode: 0o600 });
const env = { ...process.env, LD_LIBRARY_PATH: `${baseLib}:${process.env.LD_LIBRARY_PATH || ''}` };
const check = JSON.parse(execFileSync(python, ['-c', 'import sys,json; print(json.dumps({"prefix":sys.prefix,"basePrefix":sys.base_prefix,"baseExecutable":sys._base_executable,"path":sys.path}))'], { encoding: 'utf8', env }));
if (path.resolve(check.prefix) !== root) throw new Error(`unexpected venv prefix: ${check.prefix}`);
if (path.resolve(check.basePrefix) !== base) throw new Error(`unexpected base prefix: ${check.basePrefix}`);
if (!path.resolve(check.baseExecutable).startsWith(baseBin + path.sep)) throw new Error(`base executable escaped: ${check.baseExecutable}`);
if (check.path.some((entry) => entry && !path.resolve(entry).startsWith(root + path.sep))) throw new Error('sys.path escaped the runtime root');
console.log(JSON.stringify({ root, prefix: check.prefix, basePrefix: check.basePrefix, baseExecutable: check.baseExecutable }));
