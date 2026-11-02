# Habitat 运维手册

> 正常停机与恢复统一使用 `tools/win/habitat.ps1 -Action stop|start|status|resume`，详见 [shutdown.md](shutdown.md)。

## 启动顺序

Windows 薄启动器只负责 WSL keepalive 与核心服务：

```powershell
powershell -File tools/win/start-wsl.ps1
```

也可以在 WSL 内手工操作：

```bash
systemctl start habitat-stage habitat-control habitat-desktop habitat-agent
```

核心服务不包含 Outlet 编码进程。首次使用先由主人安装 `node tools/install-plugin.mjs hls`；安装不等于开播。只有真正开播时才通过 Supervisor 启动 HLS 消费者：

```bash
systemctl start habitat-outlet-supervisor
node control/outlet-host.mjs start hls
node control/outlet-host.mjs status
node control/outlet-host.mjs stop hls
```

`start` 返回 `accepted + instanceId + starting`，只表示命令被接受，不表示推流已经成功；`status` 中的 `running` 只表示进程存活。`stop hls` 会等待真实退出，超时才升级 SIGKILL，并返回最终退出状态。旧 pidfile 不再作为杀进程依据，Supervisor 重启后遗留运行状态标为 `interrupted`。

`stop hls` 会关闭 CaptureSession；最后一个消费者离开后，Desktop 停止像素帧泵，但 Agent、QQ、MC 等业务状态继续存在。

## 验收

```bash
node agent/verify-session.mjs
node desktop/verify-compositor.mjs
node agent/verify-agent.mjs
node adapters/verify-plugin-registry.mjs
node agent/verify-event-pump.mjs
node agent/verify-outbox.mjs
node agent/verify-residence-memory-store.mjs
node agent/verify-after-action.mjs
node agent/verify-episode.mjs
node agent/verify-memory-slice.mjs
node clients/verify-bilibili-supervisor.mjs
node clients/verify-onebot-supervisor.mjs
node mcp/verify-mcp.mjs
node control/verify-outlet-supervisor.mjs
node control/verify-tasks.mjs
node tools/verify-distribution.mjs
bash tools/verify-install.sh
```

实时接口检查：

```bash
curl http://127.0.0.1:9260/status       # Desktop 文字声明与消费者
curl http://127.0.0.1:9230/live/status  # HLS 是否仍在更新
curl http://127.0.0.1:9240/status       # 控制面
curl http://127.0.0.1:9240/pump/status  # 事件泵水位、死信、心跳与退避
curl http://127.0.0.1:9240/qq/status    # QQ WS 状态（默认 disabled，需显式配置）
curl http://127.0.0.1:9240/presence     # 各 residence 状态与整体聚合
```

`qq.reply` 默认不对任何群或私聊自动发送。若只给某个群开启 addressed 回复，将 `config/residence-policy.example.json` 复制为 `/etc/habitat/residence-policy.json`，仅保留目标 residence，设置 `respond: "addressed"` 后重启 `habitat-agent`。目标由策略绑定，模型不能指定其他群或用户。

安装签名插件必须通过主人控制面：`node tools/install-plugin.mjs qq`。Control 会验证索引签名、制品哈希、撤销状态和解包安全，普通模型或群消息不能安装。默认索引为 `https://github.com/TLBtianhu/habitat-plugins/releases/latest/download/index.json`，可用 `HABITAT_PLUGIN_INDEX_URL` 替换。插件停用、启用、撤销和卸载使用 `node tools/plugin-admin.mjs <disable|enable|revoke|unrevoke|uninstall> <plugin-id>`；停用/撤销会立即断开 runtime、取消重连并禁止工具调用，重启后状态仍保持。

跨频道发言必须由主人创建并批准任务：先 `POST /tasks`，`type` 为 `cross_channel.message`，提供 `targetResidenceId` 和 `text`，再 `POST /tasks/<id>/approve`。执行前会再次检查目标策略和限频，outbox 防止重复发送。

跨频道发言必须由主人创建并批准任务：先 `POST /tasks`，`type` 为 `cross_channel.message`，提供 `targetResidenceId` 和 `text`，再 `POST /tasks/<id>/approve`。执行前会再次检查目标策略和限频，outbox 防止重复发送。

## 观看

- 主人控制台：`http://127.0.0.1:9240/?token=<owner-token>`
- HLS：`http://127.0.0.1:9230/hls/live.m3u8`
- 舞台：`http://127.0.0.1:9230/`
- Desktop：`http://127.0.0.1:9260/status`（只读声明；`capture/open` 需要 Agent/Owner 凭证，读帧/关闭需要每次捕获独立 token，带 revision 与 expiresAt）
- 旧 `display/server.mjs` 已退役，不能使用。

## 本地语音

Voice Server 独立于 LLM 与 Desktop：

```bash
systemctl start habitat-voice
curl http://127.0.0.1:9270/health
```

在控制台 Chat 页点击“开启声音”。浏览器要求这是一次真实用户操作；开启后，大肥鱼选择 `voice.speak` 的回复才会生成 Utterance，并由控制台按需拉取 WAV 播放。只用 `system.say` 时不会生成语音。

- 默认后端是 **Kokoro 82M 神经 TTS + sherpa-onnx CPU**，当前为中文预置测试音色，不是大肥鱼专属音色；`espeak-ng` 仅保留为备用；
- `voice.library` 提供多个 VoiceProfile，Agent 通过 `voice.speak` 按消息选择音色；关闭音色库会拒绝新合成，文字对话不受影响；
- 控制台音色下拉框可修改默认音色并试听；默认值保存到 `/etc/habitat/voice.json`，Agent 无权修改，试听不进入系统聊天；
- Kokoro 模型在 `/var/lib/habitat/models/tts/kokoro-multi-lang-v1_0/`，需要时显式运行 `bash tools/install-kokoro.sh`，普通升级不自动下载；
- 没有音频消费者时只保留文字，不调用 TTS；
- 第一次拉取音频才合成，之后复用缓存；
- Utterance：`/var/lib/habitat/utterances.jsonl`；播放开始/完成/取消/失败由 owner 控制台回报，没有完成证据时 AfterAction 保持 unknown；
- AfterAction：`/var/lib/habitat/after-action.jsonl`；验证成功的步骤元数据：`/var/lib/habitat/skill-library.json`；
- WAV 缓存：`/var/lib/habitat/cache/tts/`；
- 大肥鱼授权 VoiceProfile、流式首段合成、多总线混音尚未接入；
- `audio/mixer-service.mjs` 已提供独立连续音轨：`127.0.0.1:9271`，统一输出 48kHz 双声道 PCM；无消费者不拉取语音，无讲话时输出静音；
- HLS Outlet 会同时订阅 Desktop 视频与 Audio Mixer 音轨，输出 H.264 + AAC；已通过本地流内真实语音验证。

## 控制台两人直播间

打开 `http://127.0.0.1:9240/?token=<owner-token>` 的 Chat 页，主人即可与大肥鱼进行系统级对话。

- `system.chat` 是 Core 常驻通道，不依赖 MC、QQ、B 站或 Desktop 是否开启；
- `system.say` 只回复控制台，不会转发到游戏或第三方应用；
- B 站弹幕、MC 游戏聊天、QQ 消息始终留在各自应用命名空间；
- 本地观众通过 `stage/live.html` 发言时身份是 `viewer`，主人控制台使用 owner token，Agent 使用独立 agent token；
- 消息每 2 秒自动刷新，只更新消息区，不会清空主人正在输入的草稿；
- 消息追加保存到 `/var/lib/habitat/system-chat.jsonl`，Agent 已读水位保存到 `/var/lib/habitat/agent-system-chat.json`；重启与离线留言均可恢复；
- 已验证真实 LLM 两人对话、离线补收、重启不重复回复与防自回复，测试消息随后会按内容核验清理，不作为演示弹幕保留。

详细边界见 `docs/design/system-chat.md`。

## 磁盘与日志

- `/etc/logrotate.d/habitat` 已限制 `/var/lib/habitat/logs/*.log`：单文件 10MB、保留 7 份并压缩，避免 MC 等日志再次增长到几十 GB；
- Kokoro 只在 `/var/lib/habitat/models/tts/` 保留一份模型，临时下载包校验后应删除；
- WSL 内删除文件不一定立即缩小 Windows 的 `ext4.vhdx` 已分配大小；完全回收需要在维护窗口 `wsl --shutdown` 后离线压缩 VHDX，不能为了压缩擅自停止当前服务。

## 常见问题

### WSL 每隔一会儿断线

WSL 在空闲后可能回收整台虚拟机，导致端口与服务一起消失。保持：

```powershell
wsl -d Ubuntu -- sleep infinity
```

开机脚本 `tools/win/start-wsl.ps1` 已包含此 keepalive。

### 提示找不到 Java / JAVA_HOME

模组构建必须走 `tools/mod-build.sh`，它强制使用 WSL 原生 JDK，不继承宿主 PATH。

### 画面不动了

```bash
curl http://127.0.0.1:9260/status
cat /var/lib/habitat/artifacts/pipeline.json
curl http://127.0.0.1:9230/live/status
```

- `producing=false`：没有捕获消费者，或 Desktop AppSession 已关闭；
- `frameFresh=false`：MC 像素文件超过 3 秒未更新，系统故意不显示旧截图；
- HLS 默认用 CPU 编码保证当前 5fps 桌面实时性；`FB_GPU_ENCODER=nvenc` 仍是可选实验项；
- 没有真实帧时不会再由 Outlet 自己生成“待机直播”。

### B 站 RTMPS

渲染与通信完全分离：RTMP Outlet 只订阅 Desktop 原始帧并编码，不拥有场景或窗口。

1. 主人在开播设置中取得推流地址与完整密钥；
2. 参考 `runtime/bilibili-live.example.json` 写入 `/etc/habitat/bilibili-live.json`；
3. 必须执行 `chmod 600 /etc/habitat/bilibili-live.json`；
4. 在主人控制台 Live 页启动“B 站 RTMPS”，并二次确认。

也可以走任务批准：AI 只能创建 `type=outlet.start、name=bilibili-rtmp` 的待办，主人批准后才启动。主人也可直接调用 `/outlets/start`，这本身就是授权动作。

- 推流地址与密钥不会写入 Outlet 日志；状态接口也不会返回它们；
- `running=true` 只表示编码进程存在，不代表平台已经确认开播；
- 音频已接入 Kokoro → Audio Mixer → AAC；视频与音频分别来自 Desktop 和 Voice，不互相渲染；
- 本地 RTMP 闭环已验证，真实 B 站推流必须在主人配置并明确启动后进行。

### QQ 屏幕共享

QQ Adapter 已复用 Desktop CaptureSession，并提供本地预览。打开、读取和关闭都只允许 Owner：

```bash
curl -X POST -H 'authorization: Bearer <owner-token>' http://127.0.0.1:9251/screen-share/open
curl -H 'authorization: Bearer <owner-token>' http://127.0.0.1:9251/screen-share/frame --output qq-frame.png
curl -X POST -H 'authorization: Bearer <owner-token>' http://127.0.0.1:9251/screen-share/close
```

这只是捕获与预览链路。QQ 视频通话传输尚未接入，OneBot 没有标准屏幕共享接口。
