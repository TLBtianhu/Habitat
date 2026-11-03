// 生成不含秘密的 systemd EnvironmentFile；所有 Habitat 路径均来自单根实例契约。
import fs from 'node:fs';
import path from 'node:path';
import { instancePaths } from '../control/instance-paths.mjs';

const args = process.argv.slice(2);
const index = args.indexOf('--root');
const root = index >= 0 ? args[index + 1] : process.env.HABITAT_INSTANCE_ROOT;
if (!root) throw new Error('usage: node tools/write-instance-env.mjs --root /opt/habitat');
const paths = instancePaths({ ...process.env, HABITAT_INSTANCE_ROOT: root });
const join = path.join;
const env = {
  HABITAT_INSTANCE_ROOT: paths.root,
  HABITAT_APP_ROOT: paths.app,
  HABITAT_DATA_ROOT: paths.data,
  HABITAT_CONFIG_ROOT: paths.config,
  HABITAT_RUNTIME_ROOT: paths.runtime,
  HABITAT_STATE_ROOT: paths.state,
  HABITAT_TMP_ROOT: paths.tmp,
  HABITAT_NODE: join(paths.runtime, 'node22', 'bin', 'node'),
  HABITAT_JAVA_HOME: join(paths.runtime, 'java', 'jdk25'),
  HABITAT_MC_JAVA_HOME: join(paths.runtime, 'java', 'jdk21'),
  HABITAT_MC_WORLD_DIR: join(paths.data, 'world-server'),
  HABITAT_MC_CLIENT_HOME: join(paths.data, 'mc-client'),
  HABITAT_MC_LAUNCHER_AUTO_START: '0',
  HOME: join(paths.data, 'home'),
  XDG_DATA_HOME: join(paths.runtime, 'xdg', 'data'),
  XDG_CONFIG_HOME: join(paths.config, 'xdg'),
  XDG_CACHE_HOME: join(paths.runtime, 'xdg', 'cache'),
  XDG_STATE_HOME: join(paths.state, 'xdg'),
  HABITAT_OWNER_TOKEN_FILE: join(paths.config, 'owner.token'),
  HABITAT_AGENT_TOKEN_FILE: join(paths.config, 'agent.token'),
  HABITAT_NAPCAT_TOKEN_FILE: join(paths.config, 'napcat.token'),
  MCPFABRIC_TOKEN_FILE: join(paths.config, 'mcpfabric.token'),
  HABITAT_LLM_CONFIG: join(paths.config, 'llm.json'),
  HABITAT_RESIDENCE_POLICY: join(paths.config, 'residence-policy.json'),
  HABITAT_VOICE_POLICY: join(paths.config, 'voice.json'),
  HABITAT_BILIBILI_COOKIE_FILE: join(paths.config, 'bilibili-cookies.txt'),
  HABITAT_BILIBILI_CONFIG: join(paths.config, 'bilibili.json'),
  HABITAT_BILIBILI_LIVE_CONFIG: join(paths.config, 'bilibili-live.json'),
  HABITAT_EPISODE_DIR: join(paths.data, 'episodes'),
  HABITAT_MEMORY_DIR: join(paths.data, 'memory'),
  HABITAT_OUTBOX: join(paths.data, 'outbox', 'agent.json'),
  HABITAT_CONTROL_OUTBOX: join(paths.data, 'outbox', 'control-tasks.json'),
  HABITAT_SYSTEM_CHAT_PUMP: join(paths.data, 'pump', 'system-chat.json'),
  HABITAT_SYSTEM_CHAT_WATERMARK: join(paths.data, 'agent-system-chat.json'),
  HABITAT_ONEBOT_STATUS_FILE: join(paths.data, 'pump', 'onebot-status.json'),
  HABITAT_PRESENCE_FILE: join(paths.data, 'pump', 'presence.json'),
  HABITAT_CHAT_LOG: join(paths.data, 'system-chat.jsonl'),
  HABITAT_TASKS_FILE: join(paths.data, 'control-tasks.json'),
  HABITAT_AFTER_ACTION_FILE: join(paths.data, 'after-action.jsonl'),
  HABITAT_SKILL_LIBRARY: join(paths.data, 'skill-library.json'),
  HABITAT_LIFECYCLE_FILE: join(paths.data, 'lifecycle.json'),
  HABITAT_SESSION_PATH: join(paths.data, 'app-sessions.json'),
  HABITAT_PLUGIN_CACHE: join(paths.data, 'plugins'),
  HABITAT_UTTERANCE_LOG: join(paths.data, 'utterances.jsonl'),
  HABITAT_TTS_CACHE: join(paths.data, 'cache', 'tts'),
  HABITAT_MODELS_DIR: join(paths.data, 'models'),
  HABITAT_OUTLET_STATE_DIR: join(paths.data, 'outlets'),
  HABITAT_OUTLET_LOG_DIR: join(paths.data, 'logs', 'outlets'),
  HABITAT_ADAPTER_STATE_DIR: join(paths.data, 'adapters'),
  HABITAT_PIPELINE_STATUS: join(paths.data, 'artifacts', 'pipeline.json'),
  HABITAT_HLS_PLAYLIST: join(paths.data, 'hls', 'live.m3u8'),
  FB_STAGE_ROOT: join(paths.app, 'stage'),
  FB_HLS_ROOT: join(paths.data, 'hls'),
  FB_MC_FRAME: join(paths.data, 'artifacts', 'mc-pixels.jpg'),
  PATH: `${join(paths.runtime, 'node22', 'bin')}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
  LD_LIBRARY_PATH: [join(paths.runtime, 'tts-venv', 'base', 'lib'), join(paths.runtime, 'deps'), join(paths.runtime, 'chrome-libs'), join(paths.runtime, 'chrome', 'chrome-headless-shell-linux64')].join(':'),
};
const destination = join(paths.state, 'instance.env');
fs.mkdirSync(paths.state, { recursive: true, mode: 0o700 });
const lines = Object.entries(env).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
  if (/\r|\n/.test(String(value))) throw new Error(`invalid environment value: ${key}`);
  return `${key}=${JSON.stringify(String(value))}`;
});
const temporary = `${destination}.${process.pid}.tmp`;
fs.writeFileSync(temporary, lines.join('\n') + '\n', { mode: 0o600 });
fs.renameSync(temporary, destination);
console.log(destination);
