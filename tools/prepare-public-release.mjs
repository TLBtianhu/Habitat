// 生成可公开的 Habitat 源码快照：只复制允许内容，清除个人路径/账号/秘密，排除运行数据和第三方资产。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || path.join(ROOT, '..', 'deepseek直播-public');
if (path.basename(OUT) !== 'deepseek直播-public') throw new Error('输出目录必须是 deepseek直播-public');
const INCLUDE = [
  'README.md', 'ARCHITECTURE.md', 'PLAN.md', 'worlds.json', 'package.json', 'package-lock.json',
  'agent', 'adapters', 'audio', 'clients', 'control', 'desktop', 'director', 'identity', 'mcp',
  'plugins', 'runtime', 'stage', 'tools', 'voice', 'config', 'docs',
];
const EXCLUDE = /node_modules|artifacts|\.git|dist|\.tmp|\.log$|mc-1\.21\.4|work\/|world-server|stage\/hls|bot(?:-host)?(?:\/|$)|display(?:\/|$)|assets-packs|tools\/legacy|tools\/REPORT\.md|tools\/test-|clients\/test-|voice\/runtime\/python|voice\/models|voice\/cache|docs\/research\/character|stage\/diagnostics\.json/;
const TEXT = /\.(?:mjs|js|json|md|sh|ps1|ya?ml|txt)$/i;
const PERSONAL = {
  token: ['a11e9f', '83618f4451a79533ef02db51d4'].join(''),
  webui: ['c2bf3d', 'b1b880'].join(''),
  owner: ['30680', '15617'].join(''),
  account: ['364684', '0573'].join(''),
  oldAccount: ['399795', '1865'].join(''),
  group: ['109859', '1186'].join(''),
};
const REPLACEMENTS = [
  ['/opt/habitat/runtime/node22', '/opt/habitat/runtime/node22'],
  ['/opt/habitat/runtime/jdk25', '/opt/habitat/runtime/jdk25'],
  ['/opt/habitat/runtime/jdk21', '/opt/habitat/runtime/jdk21'],
  ['/opt/habitat/runtime/chrome', '/opt/habitat/runtime/chrome'],
  ['/opt/habitat/runtime/tts-venv', '/opt/habitat/runtime/tts-venv'],
  ['/opt/habitat/runtime/deps', '/opt/habitat/runtime/deps'],
  ['/opt/habitat', '/opt/habitat'],
  ['/opt/habitat/src', '/opt/habitat/src'],
  ['C:/Habitat', 'C:/Habitat'],
  ['C:\\deepseek直播', 'C:\\Habitat'],
  ['C:\\Users\\30680', 'C:\\Habitat'],
  [PERSONAL.owner, '123456789'],
  [PERSONAL.account, '<QQ_ACCOUNT_ID>'],
  [PERSONAL.oldAccount, '<QQ_OLD_ACCOUNT_ID>'],
  [PERSONAL.group, '987654321'],
  ['192.168.1.100', '192.168.1.100'],
  ['"host": "127.0.0.1"', '"host": "127.0.0.1"'],
  ['"port": 3001, "token": "<NAPCAT_ACCESS_TOKEN>" }', '"port": 3001, "token": "<NAPCAT_ACCESS_TOKEN>" }'],
  ['"port": 3002, "token": "<NAPCAT_ACCESS_TOKEN>" }', '"port": 3002, "token": "<NAPCAT_ACCESS_TOKEN>" }'],
];

function sanitize(text) {
  if (text.includes(PERSONAL.token) || text.includes(PERSONAL.webui)) throw new Error('发现真实 token，拒绝发布');
  for (const [from, to] of REPLACEMENTS) text = text.replaceAll(from, to);
  return text;
}
function copy(rel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(OUT, rel);
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(src)) copy(path.join(rel, name));
    return;
  }
  if (EXCLUDE.test(rel.replaceAll('\\', '/'))) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (TEXT.test(rel)) fs.writeFileSync(dst, sanitize(fs.readFileSync(src, 'utf8')));
  else fs.copyFileSync(src, dst);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const rel of INCLUDE) copy(rel);

const mit = `MIT License\n\nCopyright (c) 2026 Habitat contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
fs.writeFileSync(path.join(OUT, 'LICENSE'), mit);
fs.writeFileSync(path.join(OUT, '.gitignore'), `node_modules/\ndist/\nbuild/\n.tmp/\nartifacts/\nvoice/runtime/python/\nvoice/models/\nvoice/cache/\nassets-packs/\nbot/\nbot-host/\ndisplay/\n*.log\n.env*\n*.token\n*.key\n*.pem\n*.pfx\n*.p12\n**/.dsh/\n**/.agents/\n**/episodes/\n**/memory/\n**/outbox/\n**/pump/\n**/utterances.jsonl\n**/control-tasks.json\n**/system-chat.jsonl\n**/after-action.jsonl\n**/skill-library.json\n**/lifecycle.json\n**/world-server/\n**/hls/\n**/cache/\n**/coverage/\nstage/diagnostics.json\n`);
fs.writeFileSync(path.join(OUT, 'NOTICE.md'), `# 第三方组件与许可边界\n\nHabitat 本仓库源码采用 MIT。以下组件不因其被调用、适配或可选安装而自动改授 MIT：\n\n- Node.js、JDK/JRE、Chrome、FFmpeg、Python、ONNX Runtime、Kokoro 模型：各自许可证与再分发条件；\n- '@resvg/resvg-js'、'ws'：按各自包许可证；\n- NapCat、mcpfabric、Minecraft/Fabric、B站/QQ 平台组件：各自许可证与平台条款；\n- Live2D、角色立绘、声音样本、第三方模型和其他素材：不纳入本公开源码快照，需单独审核与授权；\n- DSH 仅作研究参考，不把 DSH 的产品名、商标或源码并入 Habitat 的 MIT 声明。\n\n运行时、插件和角色资源与本体分开分发。任何下载、打包或再分发必须保留相应 NOTICE、源代码提供义务（如适用）和许可证文本。\n`);
fs.writeFileSync(path.join(OUT, 'SECURITY.md'), `# 安全说明\n\n- 默认仅绑定 127.0.0.1；远程观看、公开推流、插件安装和跨频道发送均需主人显式授权。\n- owner、agent、capture、NapCat、mcpfabric、RTMP、B站 cookie 是不同秘密，不得写入仓库、Issue 或日志。\n- 不要把真实账号、群号、私聊、模型、语音样本或用户数据提交为测试附件。\n- 发现安全问题请私下报告，附上复现路径、影响范围和脱敏日志，不要先公开利用细节。\n`);
fs.writeFileSync(path.join(OUT, 'CONTRIBUTING.md'), `# 贡献指南\n\n1. 使用独立开发目录，不把构建产物、用户数据或真实账号配置带入提交。\n2. 运行 'node agent/verify-episode.mjs'、'node agent/verify-memory-slice.mjs'、'node adapters/verify-plugin-registry.mjs'。\n3. 新增插件必须提供 manifest、provider、权限、生命周期、配置 schema、错误语义和测试。\n4. 不默认开启公网推流、任意群发送、Shell、文件写入或宿主显示/输入控制。\n5. 代码贡献默认采用 MIT；第三方代码、模型、角色和插件必须单独注明许可证，不得混入本体许可。\n6. 发行前运行 'node tools/verify-public-release.mjs'，并检查构建中间物没有写入设置、缓存或索引。\n`);
fs.writeFileSync(path.join(OUT, 'README.md'), `# Habitat\n\nHabitat 是一个多场所 AI 运行时：大肥鱼可以在系统控制台、QQ、B站和 Minecraft 中活动，但人格、任务状态和社交记忆不再混成一个全局聊天框。\n\n## 当前能力\n\n- 'manifest + provider' 插件化应用与工具注册；\n- 'ResidenceContext + ChannelPolicy'：按场所控制回复、限频、目标和权限；\n- 'Episode + MemorySlice'：统一当前任务，同时保留分域社交记忆；\n- 持久化事件泵、Durable Outbox、AfterAction 证据验收；\n- QQ OneBot、B站 WSS、MC mcpfabric、Voice/Desktop/Outlet 适配器；\n- 本地 Kokoro 语音、可撤销捕获 token、真实 Outlet 进程监督；\n- 用户目录安装、staging 升级、坏包回滚和发行权限验收。\n\n**默认只读/本地优先**：不自动公开推流、不自动向任意群发送、不控制宿主显示和输入。控制台/Control API 才是最高权威的主人交互面。\n\n## 快速验收\n\n~~~bash\nnpm install\nnode agent/verify-episode.mjs\nnode agent/verify-memory-slice.mjs\nnode agent/verify-residence-policy.mjs\nnode adapters/verify-plugin-registry.mjs\n~~~\n\nWSL 发行安装属于 provisioning，详见 'docs/ops/'。普通源码验收不需要管理员/root。\n\n## 分发形态\n\n| 形态 | 用途 | 数据位置 |\n|---|---|---|\n| 编译中间物 | 仅用于生成发行物，不是分发形态 | 不写设置、缓存或索引，不给用户直接使用 |\n| 便携版 | 可移动、自包含副本 | 程序目录旁，不碰注册表 |\n| 安装版 | 系统/用户安装、文件关联和卸载 | 用户配置目录，卸载保留数据 |\n\n三者路径和数据路径分离，可以同机并存。详见 'docs/distribution/forms.md'。\n\n## 运行时与插件\n\n运行时按 lockfile 固定版本、哈希、ABI 和 SBOM，不依赖用户的系统 JDK/npm/pip 自动更新。核心、应用插件和角色资源分开分发，插件还有独立权限与许可。详见 'docs/distribution/runtime-policy.md' 与 'docs/distribution/plugin-ecosystem.md'。\n\n## 许可\n\n本仓库代码采用 [MIT](LICENSE)。第三方运行时、模型、插件和角色资源不因被调用而自动改授 MIT；请阅读 [NOTICE.md](NOTICE.md)。\n`);
fs.mkdirSync(path.join(OUT, 'docs', 'distribution'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'docs', 'distribution', 'forms.md'), `# 三种形态与路径解耦\n\n## 编译中间物（开发环境）\n\n- 只用于构建便携版/安装包，不是分发形态；\n- 必须保持纯净：不写设置、缓存、索引、聊天、记忆、模型或 token；\n- 不进入用户开始菜单，也不作为日常运行入口；\n- 构建失败只影响中间物，不污染发行目录。\n\n## 便携版\n\n- 拷到任意位置即可自包含运行；\n- 'app/'、'runtime/'、'data/'、'config/' 可放在同一便携目录旁；\n- 不写注册表，不依赖系统 JDK/npm/pip，不要求管理员；\n- 可与开发目录、安装版同时存在。\n\n## 安装版\n\n- 应用可安装到系统目录或用户安装目录；\n- 安装版才拥有注册表、文件关联和卸载入口；\n- 配置与用户数据放 '%APPDATA%/Habitat'，大模型/缓存放 '%LOCALAPPDATA%/Habitat/cache'；\n- 卸载默认保留配置、记忆、模型和用户数据，只有明确 purge 才清理。\n\n开发用编译中间物，日常用安装版或便携版；开发者和普通用户不是同一顶帽子。\n`);
fs.writeFileSync(path.join(OUT, 'docs', 'distribution', 'runtime-policy.md'), `# 运行时管理\n\n## 不依赖系统自动更新\n\n运行时不直接调用用户的 JDK、npm、pip 或“最新版本”。构建期可以从官方源/镜像取得输入，但发行时固定：\n\n- 精确版本、平台、架构、ABI、SHA256、签名与 SBOM；\n- Node、JDK、Python、Chrome、FFmpeg、ONNX Runtime、Kokoro 和 npm 依赖的兼容组合；\n- staging 下载、完整性与安全路径校验、健康检查、失败回滚；\n- 官方源仅作输入，运行时由 Habitat 统一管理，用户系统更新不会悄悄改变它。\n\n## 分包边界\n\n- 'core-runtime'：Node、核心 npm 依赖和必要本地库；\n- 'media-runtime'：Chrome/FFmpeg/Resvg；\n- 'voice-runtime'：Python/sherpa-onnx/Kokoro；\n- 'app-runtime'：QQ/B站/MC 等应用插件的独立依赖。\n\n本体 MIT 不等于这些运行时统一 MIT；每个包带自己的许可证、NOTICE 和必要的源代码/下载信息。\n`);
fs.writeFileSync(path.join(OUT, 'docs', 'distribution', 'plugin-ecosystem.md'), `# 插件生态与插件源\n\n## 先签名索引，不急着自建服务器\n\n第一阶段使用 GitHub 托管的签名插件索引，不必马上维护一台插件服务器：\n\n- 每个插件包含 'id/version/apiRange/entry/capabilities/scopes/permissions/lifecycle/license'；\n- 包含制品 URL、SHA256、签名、兼容范围和撤销列表；\n- 主人安装/批准插件及其 scope，模型和普通观众不能安装插件；\n- 下载到本地缓存，校验签名和哈希后再由 PluginRegistry 加载；\n- 撤销后禁止新激活，已运行的实例按 owner 决定停用或保留只读。\n\n## 本体与应用分开\n\n核心 Habitat 与 QQ/B站/MC/HLS 等应用插件分开打包、分开版本、分开许可。应用插件不被本体 MIT 自动覆盖，插件作者保留自己的许可证。\n\n后续需要私有索引、团队审核或访问控制时，再把同一索引协议迁移到自建服务器，客户端不必改变。\n`);
fs.writeFileSync(path.join(OUT, 'runtime', 'lock.example.json'), JSON.stringify({
  schemaVersion: 1,
  bundle: 'habitat-core-runtime',
  platform: 'linux-x64',
  node: { version: '22.x-pinned', sha256: '<required>' },
  jdk: { version: '21.x-pinned', sha256: '<required>' },
  chrome: { version: '<pinned>', sha256: '<required>' },
  ffmpeg: { version: '<pinned>', sha256: '<required>' },
  kokoro: { version: '<pinned>', sha256: '<required>' },
  sbom: 'sbom.json',
  signature: '<required>',
}, null, 2) + '\n');
console.log('public snapshot prepared:', OUT);
