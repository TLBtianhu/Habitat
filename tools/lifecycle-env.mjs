// 读取 Habitat 生成的实例环境；只接受 KEY=JSON 字符串，绝不作为 shell 执行。
import fs from 'node:fs';
import path from 'node:path';

export function loadInstanceEnv({ root, envFile = path.join(root, 'state', 'instance.env'), env = process.env } = {}) {
  if (!root) throw new Error('instance root required');
  env.HABITAT_INSTANCE_ROOT ||= root;
  if (!fs.existsSync(envFile)) return env;
  const text = fs.readFileSync(envFile, 'utf8');
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line) continue;
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`invalid instance env line ${index + 1}`);
    const [, key, serialized] = match;
    const value = JSON.parse(serialized);
    if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error(`invalid instance env value: ${key}`);
    if (env[key] === undefined) env[key] = value;
  }
  return env;
}
