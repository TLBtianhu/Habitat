// Habitat lifecycle CLI：仅供受控安装/启停脚本调用，不提供任意命令入口。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecoveryManager } from '../control/recovery.mjs';
import { loadInstanceEnv } from './lifecycle-env.mjs';

// systemd 已注入这些变量；Windows/root 启停命令则从同一实例环境补齐，不能写回旧 /var/lib 路径。
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadInstanceEnv({ root: process.env.HABITAT_INSTANCE_ROOT || path.dirname(appRoot) });

const action = process.argv[2];
const manager = new RecoveryManager();
const actions = {
  boot: () => manager.boot(),
  ready: () => manager.ready(),
  stopping: () => manager.stopping(),
  stopped: () => manager.stopped(),
  status: () => manager.status(),
  recover: () => manager.recover(),
};
if (!actions[action]) throw new Error('usage: node tools/lifecycle.mjs <boot|ready|stopping|stopped|status|recover>');
const result = await actions[action]();
if (action === 'status' || action === 'recover') console.log(JSON.stringify(result, null, 2));
