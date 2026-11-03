// 单根实例路径契约：所有资产必须位于实例根内部，禁止隐式落到 home、/etc 或 /var/lib。
import path from 'node:path';

function inside(root, candidate, name) {
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${name} must be a child of the instance root`);
  }
  return candidate;
}

export function instancePaths(env = process.env) {
  const root = path.resolve(env.HABITAT_INSTANCE_ROOT || '/opt/habitat');
  const child = (name, envName) => {
    const value = env[envName];
    const candidate = value ? path.resolve(root, value) : path.join(root, name);
    return inside(root, candidate, envName);
  };
  return Object.freeze({
    root,
    app: child('app', 'HABITAT_APP_ROOT'),
    data: child('data', 'HABITAT_DATA_ROOT'),
    config: child('config', 'HABITAT_CONFIG_ROOT'),
    runtime: child('runtime', 'HABITAT_RUNTIME_ROOT'),
    state: child('state', 'HABITAT_STATE_ROOT'),
    tmp: child('tmp', 'HABITAT_TMP_ROOT'),
  });
}
