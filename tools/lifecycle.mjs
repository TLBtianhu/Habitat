// Habitat lifecycle CLI：仅供受控安装/启停脚本调用，不提供任意命令入口。
import { RecoveryManager } from '../control/recovery.mjs';

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
