# Habitat 当前进度、遗留问题与关机记录

记录时间：2026-11-07（Asia/Shanghai）
范围：多场所运行时、Bilibili 推流、QQ/NapCat、OneBot、WSL、MC、证据与运维边界。

## 1. 一句话结论

Habitat 已完成多场所身份/任务状态、Owner 权限、真实 B 站音视频推流、播放证据、编码会话证据及 NapCat/WSL 稳定性修复，并完成过 15 分钟 VBV 公开验证。

但**当前不是“全自动运营完成版”**：`autonomous=off`，当前没有公开推流；NapCat 当前为 `offline/auth_required`，OneBot 与 Agent 当前 degraded，不能把之前的 ready 当作现在仍在线。长期自治、官方音色、真实 MC 世界和 SnowLuma 独立网关仍未完成。

## 2. 关机前实际状态

| 范围 | 当前证据 | 含义 |
|---|---|---|
| B 站输出 | `state=stopped`、`live=false`、`stopReason=max_duration` | 没有正在进行的公开推流 |
| 推流策略 | `autonomous=off` | Agent 不得自行开播；重启不得自动恢复公开推流 |
| 推流凭证状态 | `requiresRefresh=false` 是上次成功验证后的状态 | 不是永久有效证明；新会话仍需真实验证 |
| NapCat 登录 | `isLogin=false`、`coreReady=false`、`loginPhase=offline`、`auth_required` | 当前登录态已失效或处于离线状态，需要 Owner 重新认证，不伪造 ready |
| OneBot | HTTP `get_status` 超时，Agent `/qq/status=degraded` | 当前不能宣称 QQ/OneBot 可用 |
| NapCat 运行 | `napcat-runtime` 为 host 网络、running，记录时约 44 小时 | 进程运行不等于 QQ 在线 |
| WSL | 当前 Ubuntu running；此前同一 boot id 跨多个原空闲周期未变化 | 空闲自动关机修复已生效，不等于所有登录问题已消失 |
| NapCat 服务 | `napcat-attached.service` enabled/active，`Restart=no` | 有显式停止边界，不靠无限重启掩盖故障 |
| Habitat 生命周期 | `state=running`、`recoveryRequired=false`、`lastShutdownAbnormal=true`、`streamAttention=false` | 异常关机是历史标记，无待恢复写入；不自动开播 |
| SnowLuma | 独立网关仍不可达 | 与 NapCat 不同，不宣称为同一服务，未代启 |
| MC | 当前没有已连接世界的真实证据 | 兼容状态/适配器存在不等于世界在线 |

## 3. 已完成的核心能力

### 3.1 多场所与权限

- 一个身份下共享 Episode/task 状态，社交记忆按场所隔离。
- Owner 控制台拥有最高权限；Owner 停止优先于 Agent。
- `stream.propose` 已接入真实 AgentLoop，而非只验证 HTTP token。
- 参数、房间/场景别名、时长和权限受控；跨 residence 输入不能触发推流。
- Owner/Agent 的 `lastActor`、意图去重、冷却、每日额度、时间窗、停止队列和重启隔离均有实现。
- 重启时对 scheduled/active intent 做隔离，不重放历史公开推流。
- 对播放证据、凭证失效和 ambiguous transport failure 分开处理，不把未知结果当成成功。

### 3.2 真实 B 站推流与音频

- 已使用真实 RTMP 输出、真实公开播放和独立音频采集完成验证。
- `audio:'mixer'` 使用真实 PCM 48kHz、立体声回环，不把麦克风或 fake silent-AAC 当成真实音频。
- 曾取得公开非静音音频证据，首个峰值约 `-6.2dB`；这只是非静音证据，不是语义身份验证。
- 当前测试音色是通用 Kokoro，**不是官方“大肥鱼”音色**；没有把音色或语音身份说成已正式完成。

### 3.3 视频节奏与 FFmpeg 可观测性

- `PacedVideoInput` 使用单调时钟调度，实际捕获时间与输出节奏分开。
- 保留最新帧、必要时重复、过期后使用明确生成的待机帧，不把旧画面冒充实时画面。
- 已加入真实写入帧龄、重复/丢弃调度间隔、待机帧和背压指标。
- 接入 FFmpeg `-progress pipe:2`，记录 `out_time`、`total_size`、`speed`、重复帧和丢帧。
- `speed` 是 FFmpeg 处理速度，不是单独网络测速。
- 公开播放分析使用“先截取原封包，再本地分析”的方式，计算帧间隔、最大间隔、音视频起始差、持续时长差和非单调时间戳。
- 样本不足明确标记 `insufficient_video_frames` / `insufficient_audio_frames`，不再把单帧或缺音轨当成节奏通过。

### 3.4 15 分钟 VBV 公开验证

真实会话已完成，主要结果：

- `maxDurationMs=900000`，最终 `stopReason=max_duration`。
- `rateControl=vbv`，`maxRateKbps=3500`，`vbvBufferKbps=7000`。
- `reconnectCount=0`，完成 1 个编码会话。
- 会话时长 `904058ms`，会话输出时间 `890474.667ms`。
- 写入 4463 帧、重复 1715 次、丢弃 12 个调度间隔、待机帧 2 帧，最后写入帧龄 150ms。
- 公开样本 `sample.avUsable=true`：视频 30 帧、间隔约 200ms；音频 282 帧、间隔约 21ms；起始差 0ms、持续时长差 195ms、无非单调时间戳、无异常警报。
- 会话 `stopReason=owner_stop`，调度层 `stopReason=max_duration`；停止后的历史 `lastVerifiedAt` 不被当成当前 LIVE。

证据：[stream-vbv-15min.json](</opt/habitat/data/artifacts/stream-vbv-15min.json>)、[playback-timing-sample.flv](</opt/habitat/data/artifacts/playback-timing-sample.flv>)、[ADR-044](../adr/ADR-044-vbv-15min-stability.md)。

`recentSessions` 是当前/最近编码会话，不是整场累计；`frames` 是源帧累计。以上证据不构成所有网络环境不缓冲的承诺。

### 3.5 NapCat 与 WSL 修复

- 查明 WSL 空闲自动关机和 VM 重启会带动 NapCat/Docker/OneBot 重连。
- `vmIdleTimeout=-1`、`instanceIdleTimeout=-1` 已配置，显式停机和 `wsl --shutdown` 仍可用。
- 原 `.wslconfig` 已备份为 `C:\Users\30680\.wslconfig.habitat-backup-20261105`。
- NapCat 使用 host 网络，避免 Docker bridge 登录服务断开。
- 无显示环境通过临时包装禁用 GPU，避免 Worker 重启时 GPU fatal。
- 使用 `napcat-attached.service` 附着管理，`Restart=no`，显式 `ExecStop` 清理运行容器。
- 原 `napcat` 容器与持久化卷保留，运行容器 `napcat-runtime` 复用数据，未清空登录数据。
- OneBot HTTP 使用 3001、WebSocket 使用 3002、WebUI 使用 6099，Agent 配置已对齐。

参考：[ADR-039](../adr/ADR-039-napcat-attached-runtime.md)、[ADR-040](../adr/ADR-040-napcat-host-network.md)、[ADR-041](../adr/ADR-041-napcat-disable-gpu.md)、[ADR-042](../adr/ADR-042-wsl-idle-timeout.md)。

## 4. 仍未完成或不能承诺的事项

### 4.1 QQ/NapCat 登录持续性

当前实际状态就是 `offline/auth_required`、OneBot 超时，说明登录态不能视为永久有效。

- 公开资料没有给出 QQ 登录态固定 TTL。
- `SelfOffline` 可能是静默离线并自行恢复，不能一见 `reconnecting` 就刷新二维码。
- `KickedOffLine` 与 `SelfOffline` 的恢复路径不同；不能把所有掉线归因于多端互踢或风控。
- `coreReady` 与 `isLogin` 同表达式，不能替代 OneBot WS/API 健康检查；`isOffline` 在恢复清零期间也可能为 false。
- 未证实 `signAddress` 是当前官方配置键，不能自行改设备、MAC、GUID 或签名配置来规避平台规则。
- 未找到官方对同号 NapCat 与 Windows QQ 同时在线的明确许可/禁止；不能把 Windows QQ 进程存在直接当成根因。
- 下一次启动 Habitat 后，如仍为 `auth_required`，Owner 需要重新扫码/验证码/新设备验证；不能由监控自动刷新二维码或伪造 ready。

### 4.2 B 站普通 OBS 凭证

- 官方开播页要求每次重新开播复制完整服务器地址和直播码；不要只换 `trid`。
- 没有公开证据证明 `streamname/key/trid` 各自独立 TTL、固定刷新周期或永久有效性。
- 旧 key 的立即复用曾成功，但这不是跨场复用承诺。
- 不把 OBS 重连退避上限、15 分钟测试时长或 `live_token.expire_in` 示例解释成 `trid` TTL。
- 不使用共享 Cookie、抓包私有接口或固定计算规则绕过 Owner 更新推流配置。

### 4.3 thirdPartyLive 尚未实现

它是另一条受限 Open API 流程，不是普通 OBS 的通用替代：

- 需要入驻、应用、标准 OAuth、Scope `LIVE_ROOM_DATA`、商务/运营报备及资格确认；
- 每次开播需要用户扫码或特定 URL 二次确认；
- `live_token` 是一次性 token，`live_key` 是本次开播唯一 ID，不是 OBS key；
- `startLive` 返回 `push_url/live_key/start_time`，`endLive` 使用对应 `live_key/third_live_uuid`；
- 不能把 OBS `key/trid` 与 `live_key` 混用，也不能假定 `endLive` 可关闭普通 OBS 场次；
- 风控可能要求用户到 B 站 APP 完成身份验证，Agent 不能绕过；
- 资格中特殊硬件/特定人群工具的出版物号边界仍需官方确认，不能自行判断可接入。

官方资料详见 [登录与凭证生命周期调研](../research/auth-credential-lifecycle.md)。在资格、`push_url` 编码器接入方式、有效期和失败幂等规则明确前，不实现 thirdPartyLive 自动开播。

### 4.4 自治、音色与其他场所

- 当前仍保持 `autonomous=off`，没有长期自动开播或无限重试。
- 尚未完成“有限自治”的 Owner 策略预览与批准流程；不能把 15 分钟测试直接当成自治许可。
- 还没有做场景变化 + 真实语音的长时间对比，不能仅凭低变化画面决定最终码率/fps。
- 当前公开非静音音频不等于语义语音身份验证；官方“大肥鱼”音色尚未完成。
- MC 没有真实已连接世界，SnowLuma 仍是独立且不可达的网关，不把它们算作已恢复。

### 4.5 磁盘与诊断残留

- 已按 Owner 确认清理本次快照/调研临时文件，释放约 56.7MB；没有动运行缓存、迁移备份、QQ 卷、证据或系统日志。
- 2026-11-06 审计时：QQ `crash_files` 约 4KB，没有巨型 core dump；Habitat 日志约 16MB；WSL journal 约 771.9MB。
- `.tmp` 清理后约 475MB，主要包含既有 runtime-cache、buildtools 等；`/opt/habitat/state` 的迁移备份约 474MB，QQ 持久化卷约 865MB，均不能当垃圾直接删除。
- Docker 的可回收镜像/停止容器混有回滚与其他历史资源，不使用 `docker system prune -a` 一刀切。
- 这些是当前占用而非完整历史写入量；不能把既有目录总量都归因于本次诊断。

## 5. 下一步建议

1. **先做只读 `authHealth` 投影**：记录 NapCat 登录阶段、OneBot online/good、WS 握手、最后成功时间、`requiresReauth`、Owner 下一步操作和脱敏原因。
2. 将状态区分为 `unknown / ready / reconnecting / requiresReauth / blocked / stopped`，不把历史 ready 或 lastVerifiedAt 当作当前健康。
3. 恢复时先等待官方恢复链路，不并发重启、不刷新二维码；持续失效时再要求 Owner 扫码/验证码/新设备验证。
4. 对 B 站持续 404、invalid stream 或 ambiguous transport failure 先标记为需要检查，不直接认定必须换码；只有明确授权失效或持续无法恢复时才要求重新认证/更新。
5. 登录与推流凭证恢复后，再做场景变化 + 真实语音的长时间测试，最后才讨论有限自治。
6. thirdPartyLive、官方音色、真实 MC、SnowLuma 各自独立推进，不把任何未验证状态写成完成。

## 6. 关机执行与验收

Owner 明确要求停止 Habitat 并关闭 WSL。执行顺序：

1. 使用 `tools/win/stop-habitat.ps1`，按正常顺序停止 Agent、出口、音频、桌面、控制面及 NapCat 附着服务；不删除数据，不自动开播。
2. 检查 Habitat 单元、NapCat 运行容器、FFmpeg 和公开推流状态。
3. 使用 `wsl --shutdown` 显式关闭 WSL；这不是空闲超时，而是 Owner 主动操作。
4. 验证没有运行中的 WSL 发行版、NapCat 运行容器或 FFmpeg，且没有自动恢复公开推流。

实际执行结果将在下方记录，不预先宣称成功。

## 7. 实际关机结果

- `tools/win/stop-habitat.ps1` 已执行，但**没有完全正常停止**：`napcat-runtime` 的 Docker stop 尝试后没有收到退出事件；进程检查显示 QQ 已为僵尸态。其他 Habitat 单元已 inactive，但 `habitat-agent` 与 `napcat-attached` 进入 failed。
- 生命周期文件记录为 `state=stopping`、`lastShutdownAbnormal=true`，没有把它改写为正常 stopped，也没有隐藏停止失败。
- 按 Owner 明确要求，随后执行了 `wsl --shutdown`。`wsl --list --running` 显示没有运行中的发行版；Windows 侧也没有 Habitat 的 `sleep infinity` keepalive 进程会再次启动 WSL。
- 关机前推流已经是 `stopped`、`autonomous=off`，没有活动 FFmpeg 或公开推流。WSL 关闭后不再存在运行中的 NapCat/编码器进程。
- 未删除原容器、QQ 持久化卷、迁移备份或证据。下次启动需要按实际异常状态进行恢复检查；当前 QQ 登录为 offline/auth_required，不能把历史 ready 当作恢复证明。
- 本次不是“Habitat 全部正常停机后关闭 WSL”，而是**正常停止遇到 NapCat 容器退出失败后，由 Owner 明确要求执行显式 WSL 关机**。不重放公开推流。

## 8. 主要证据与文档

- [15 分钟 VBV 公开验证](</opt/habitat/data/artifacts/stream-vbv-15min.json>)
- [公开播放节奏样本](</opt/habitat/data/artifacts/playback-timing-sample.flv>)
- [VBV 短验证](</opt/habitat/data/artifacts/stream-vbv-short.json>)
- [登录与凭证生命周期调研](../research/auth-credential-lifecycle.md)
- [15 分钟 VBV 证据 ADR](../adr/ADR-044-vbv-15min-stability.md)
- [VBV 与编码会话 ADR](../adr/ADR-043-vbv-session-evidence.md)
- [NapCat 附着运行 ADR](../adr/ADR-039-napcat-attached-runtime.md)
- [WSL 空闲关机 ADR](../adr/ADR-042-wsl-idle-timeout.md)
- [正常停机与恢复说明](shutdown.md)

最新已发布提交为 `ebb6114`，其 [CI](https://github.com/TLBtianhu/Habitat/actions/runs/42082843627) 已通过；本文提交后的新 CI 结果另行记录，不把旧 CI 当成本文提交的通过证明。
