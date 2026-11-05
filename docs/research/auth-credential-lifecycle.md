# 登录与凭证生命周期调研

日期：2026-11-06
范围：NapCat、Bilibili 普通 OBS 推流、thirdPartyLive、OBS 重连、WSL 生命周期。仅做资料与源码调研，不改变生产状态，不自动刷新二维码或推流码，不开启公开推流。

## 结论先行

1. **没有查到 NapCat 登录态固定 TTL，也没有查到普通 OBS `streamname/key/trid` 的独立有效期或固定刷新周期。**不能把一次掉线或一次 404 直接换算成固定分钟数。
2. B 站普通 OBS 开播页当前文案要求：**每次重新开播，复制新的服务器地址和直播码到直播软件中**。这是 Owner 的操作指引，不是“旧 key 永远失效”的技术证明；实测中同一完整 key 的立即复用曾成功，但不能据此承诺可跨场复用。
3. `thirdPartyLive` 不是普通 OBS 推流码的通用替代品。它需要受限接入、标准 OAuth、每次开播用户二次确认和一次性 `live_token`，并可能触发 APP 身份验证。
4. NapCat 的 `SelfOffline` 可能是静默离线并自行恢复，不能一见 `reconnecting` 就刷新二维码。只有持续无法恢复、长期停在 `waiting_qrcode`、明确需要验证码/新设备验证时，才通知 Owner 处理。
5. **监控能发现、阻止和告警，不能改变平台的有效期、风控、授权或多端规则。** Owner 仍须扫码、确认、更新完整推流配置，或向官方申请/确认资格。

## 一、NapCat 登录与恢复证据

调研基线为 NapCatQQ v4.18.42、NapCat-Docker `dc3ca1a`。当前部署日志显示 NapCat 4.18.37，版本不同，升级或修改监控前必须按实际版本复核字段，不能把新版本字段当成旧版本保证。

### 状态字段不是同一层证据

当前官方源码中，`CheckLoginStatus` 的语义为：

```text
isLogin   = qqLoginStatus && selfInfo.online === true
coreReady = qqLoginStatus && selfInfo.online === true
isOffline = qqLoginStatus && selfInfo.online === false
```

- `coreReady` 与 `isLogin` 是同一表达式，**不是额外的 OneBot 健康证明**。
- `loginPhase` 用于进度展示，不是额外的登录门槛。`waiting_qrcode` 也是内部阶段，不能据此证明二维码新鲜有效。
- `reconnecting` 指账号离线后的恢复/Worker 重启，不等于 OneBot WebSocket 重连；此阶段 `RefreshQRcode` 返回空二维码和 `restarting:true`，不应并发再次重启或刷新。
- 恢复时 `QQLoginStatus` 已被清零，因此此时 `isOffline` 也可能为 `false`，**不能只靠 isOffline 报警**。

来源：[QQLogin.ts](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-webui-backend/src/api/QQLogin.ts)、[类型定义](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-webui-backend/src/types/index.ts)、[核心源码](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-core/index.ts)。

### 两类下线处理不同

- `KickedOffLine`：收到下线通知，设置 `selfInfo.online=false` 并发出事件。
- `SelfOffline`：NapCat 将自身状态 `status===20` 的“在线→离线”跳变称为静默离线，未收到 `KickedOffLine`，只在跳变时发一次事件。
- 两者随后都会清除运行时登录标记和旧二维码、写入 `loginError`、进入 `reconnecting`，再走 Worker 重启/快速登录恢复。默认等待分别约为 **3.5 秒**和 **60 秒**；SelfOffline 若等待期间自行恢复在线则无需重启。

来源：[离线恢复逻辑](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-core/helper/offline-recovery.ts)、[Shell 接线](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-shell/base.ts)。

### 登录配置与密码边界

- 官方 Docker `entrypoint.sh` 在非空 `ACCOUNT` 时执行 `qq --no-sandbox -q $ACCOUNT`，指定快速登录账号：[entrypoint.sh](https://github.com/NapNeko/NapCat-Docker/blob/dc3ca1abc2bcb3b5f1e1087db12c1b8e337d243b/entrypoint.sh)。
- 官方 Shell 源码实现 `NAPCAT_QUICK_PASSWORD_MD5` 和 `NAPCAT_QUICK_PASSWORD`：MD5 变量优先，要求 32 位十六进制并转小写；否则将明文变量在内存中计算 MD5，用于快速登录失败或无历史记录后的密码回退：[base.ts](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-shell/base.ts)。
- 当前 Docker README 没有完整说明这三个变量，故只能称为“官方源码可确认的实现”，**不是公开 Docker 文档承诺的免扫码或稳定登录能力**。密码回退仍可能要求验证码或新设备验证。
- 明文密码和其 MD5 都按密码等价物保护，不写入 Git、日志、聊天或公开 Compose。只有 Owner 明确选择受控 Secret 注入后才考虑，不自动使用、不要求用户在聊天中提供密码。
- 官方安全资料建议避免在同一 IP/设备上同时登录 Bot 账号与常用账号，频繁掉线可更换账号或设备；这不是“同号 NapCat 与 Windows QQ 必然互踢”的明确规则：[安全文档](https://napneko.github.io/other/security)。

### `signAddress`、多端和固定有效期

- 本次未证实 `signAddress` 是当前官方配置键；当前 schema 可见 `packetServer` 等字段，不能将二者等同，也不能把社区签名配置当成官方防掉线结论：[config.ts](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-core/helper/config.ts)。
- 官方 Compose 的固定 `mac_address` 示例和 GUID/新设备验证流程只证明设备配置存在，不证明修改设备指纹可以规避失效或多端限制：[ws.yml](https://github.com/NapNeko/NapCat-Docker/blob/dc3ca1abc2bcb3b5f1e1087db12c1b8e337d243b/compose/ws.yml)、[QQLogin.ts](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-webui-backend/src/api/QQLogin.ts)。
- **未找到官方对“同一 QQ 号的 NapCat 与 Windows QQ 能否同时在线”的明确许可或禁止。**不能仅凭 Windows QQ 进程存在就归因于多端互踢，也不能据此修改设备配置。
- 公开安装、配置、安全资料和上述登录源码未给出 QQ 登录态固定 TTL，也没有 `expiresAt/expiresIn`。二维码过期、已登录会话失效、WebUI 鉴权重启失效，是三个不同概念。

## 二、Bilibili 普通 OBS 推流码

### 官方操作指引

开播设置页及当前加载的官方静态代码明确写：

> 每次重新开播，请在这里复制新的服务器地址和直播码到你的直播软件中。

刷新成功后还会提示“刷新成功，请重新复制推流码”。

来源：[开播设置](https://link.bilibili.com/p/center/index#/my-room/start-live)、[官方静态 chunk](https://s1.hdslb.com/bfs/static/blive/blfe-link-center/static/js/85.29e686a77c7877dc39f0.js)、[OBS 工具教程](https://link.bilibili.com/p/help/index#/tools-tutorial)。

工程上的稳妥解释是：Owner 每次开播按页面本次返回的**完整服务器地址 + 直播码**操作，不只替换 `trid`，也不把旧 key 当成永久配置。公开资料没有定义 `streamname/key/trid` 各自的独立语义、独立有效期、刷新周期或固定 trid TTL，因此不能声称：

- `trid` 固定多少分钟/小时失效；
- `streamname` 或 `key` 永久不变；
- 只更新 `trid` 就足够；
- 完整 key 永久有效或每次开播必然失效。

普通页面没有给 Agent 一个免登录、免授权的“普通推流码刷新 API”。不应通过共享 Cookie、抓包私有接口或固定 `trid` 计算规则绕过 Owner。

## 三、thirdPartyLive 官方授权流

### 与 OBS 不同的业务流程

官方“一键开播”是受限的第三方软硬件接入能力，业务流程明确：**每次开播都要用户通过移动端扫码或打开特定 URL 进行二次确认**。

1. `grantUrl` GET：使用 `biz_code/open_id/live_area_id/third_live_uuid` 获取 `grant_url`，生成二维码供 B 站移动客户端扫码。`third_live_uuid` 必须唯一，重复会报 `7010 重复开播`。
2. 用户确认后，厂商收到 POST 回调：`act=live_token`、`biz_code/open_id/third_live_uuid`、一次性 `live_token`、`expire_in`。厂商必须返回 HTTP 200 和 JSON `{"code":0}`；未收到响应时最多重试三次。
3. 用户确认后调用 `startLive` POST：`biz_code/open_id/live_token`，返回 `push_url/live_key/start_time`。`live_key` 是**本次开播唯一 id**，不是 OBS 页面里的 `key`。
4. `endLive` POST：使用 `biz_code/open_id/live_key/third_live_uuid`，返回 `open_id/end_time`。

官方正文与接口页：

- [能力与资格说明](https://open.bilibili.com/doc/4/2e018d85-a96e-9deb-dcd6-478fb06cb5b2)
- [业务流程](https://open.bilibili.com/doc/4/ddf67fb6-daad-6023-b67a-cc06a28caa4c)
- [grantUrl](https://open.bilibili.com/doc/4/5827c4a4-aab6-235e-624b-a47248d712e3)
- [live_token 回调](https://open.bilibili.com/doc/4/68757db2-f8bf-eab2-0b09-4bafe1d65264)
- [startLive](https://open.bilibili.com/doc/4/cafd6cf4-be34-d2c6-4d43-ca309b7ad346)
- [endLive](https://open.bilibili.com/doc/4/e84cd5ba-68fe-effe-1835-c2a2ff22a72a)

公开正文搜索接口可直接核对内容，不需登录：

- [thirdPartyLive 搜索](https://open.bilibili.com/arcopen/user/open-doc/search?search_str=thirdPartyLive&article_list_id=4)
- [live_token 搜索](https://open.bilibili.com/arcopen/user/open-doc/search?search_str=live_token&article_list_id=4)
- [一键开播资格搜索](https://open.bilibili.com/arcopen/user/open-doc/search?search_str=%E4%B8%80%E9%94%AE%E5%BC%80%E6%92%AD&article_list_id=4)

### 资格与风控

- 可咨询的接入情形包括拥有出版物号的游戏或商业应用、特殊硬件设备、为特定用户和人群设计的工具；同时明确**不能用于开发类似直播姬的公开商业通用软件**。
- 报备段列出国内公司、数据不出入境、合作应用出版物号等前置条件，并要求入驻、完成应用和标准授权、联系运营/产品商务对接并邮件报备。硬件厂商的出版物号栏可写“硬件接入”；特定人群工具是否豁免出版物号不能自行推定，需向官方确认。
- `grantUrl/startLive/endLive` 标注 `Scope=LIVE_ROOM_DATA`，需要申请权限和用户授权，并要求公共请求头及签名版本 2.0。
- 标准 OAuth 是另一层流程：`access_token` 有有效期，按返回有效期在到期前用 `refresh_token` 续期；每个 `refresh_token` 只能使用一次。新增 scope 或无法按规则续期时需要用户重新授权。参见[账号授权](https://open.bilibili.com/doc/4/eaf0e2b5-bde9-b9a0-9be1-019bb455701c)、[网页应用接入](https://open.bilibili.com/doc/4/aac73b2e-4ff2-b75c-4c96-35ced865797b)、[签名与公共请求头](https://open.bilibili.com/doc/4/8673959e-f7bb-56e6-6e68-d225f971b81b)。
- 失败示例明确可能触发风控，要求用户前往 B 站 APP 完成身份验证后重试。Agent 不能绕过。

### 有效期与替换边界

- 文档的 `expire_in` 示例为占位 `0`，且公开页未注明单位和固定值。应读取每次实际回调值，不能把示例当永久，也不能自创固定秒数。
- `live_token` 是一次性 token；`live_key` 是本次开播唯一 id。公开资料没有证明它们与普通 OBS 的 `streamname/key/trid` 属于同一可互操作体系，也没有证明 `push_url` 可以拆成普通 OBS 的服务器/串流密钥。
- `thirdPartyLive` 只有在应用/场景获批、用户完成当次授权和二次确认、且编码器能够直接使用当次 `push_url` 时，才可能替代手工复制推流信息的一环，**不是无人值守永久凭证，也不是普通 OBS 的直接替代**。

## 四、OBS 重连与 WSL 生命周期

### OBS 重连不是凭证有效期证明

当前 OBS 源码中：

- 默认重连次数为 20，初始重连等待 2 秒，指数约 1.5 加少量随机值，最大退避为 15 分钟；`obs_output_set_reconnect_settings` 可配置次数和秒数。
- 只有 `OBS_OUTPUT_DISCONNECTED` 等可重连错误会进入重连流程；`RTMP_ConnectStream` 返回 `OBS_OUTPUT_INVALID_STREAM` 时不应当作普通网络重试。
- `reconnect`、`reconnect_success` 是连接生命周期信号，不是公开播放可解码或凭证有效的证明。
- `RTMP_Connect` 与 `RTMP_ConnectStream` 分开处理，连接错误和流错误不能混为“推流码过期”。推流仍应独立验证公开播放。

来源：[obs-output.c 默认参数](https://github.com/obsproject/obs-studio/blob/master/libobs/obs-output.c#L33-L34)、[重连设置](https://github.com/obsproject/obs-studio/blob/master/libobs/obs-output.c#L1168-L1175)、[重连与停止](https://github.com/obsproject/obs-studio/blob/master/libobs/obs-output.c#L2951-L3057)、[RTMP 连接与流错误](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-outputs/rtmp-stream.c#L1217-L1229)。

**15 分钟退避上限不是 trid 刷新周期，也不是登录态 TTL。**

### WSL 空闲关机

微软配置文档给出 `vmIdleTimeout` 默认 60000ms、`instanceIdleTimeout` 默认 15000ms。WSL 源码明确：

- 实例超时小于 0 时，不注册实例空闲终止回调；
- VM 超时小于 0 时，持续运行，直到显式 `wsl --shutdown` 或服务停止。

来源：[WSL 配置文档](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)、[实例超时处理](https://github.com/microsoft/WSL/blob/master/src/windows/service/exe/LxssUserSession.cpp#L2952-L2968)、[VM 超时处理](https://github.com/microsoft/WSL/blob/master/src/windows/service/exe/LxssUserSession.cpp#L4198-L4217)。

本次反复重启还出现了 `systemd poweroff` 和 WSL 等待 10000ms 后强制断电的记录。持续运行的 Habitat 使用 `vmIdleTimeout=-1`、`instanceIdleTimeout=-1`，并不禁止 Owner 正常停机或显式 `wsl --shutdown`。全局配置会影响所有 WSL2 实例，修改前已保留备份。

## 五、建议的生命周期监控规范

### 状态与证据

| 状态 | 必须具备的证据 | 允许的动作 |
|---|---|---|
| `unknown` | 尚无足够新样本、启动中或数据过期 | 不宣称 ready，不自动开播 |
| `ready` | NapCat 登录/在线、OneBot online/good、近期 WS 握手与心跳；B 站输出运行且公开播放在 TTL 内 verified | 按 Owner 策略运行 |
| `reconnecting` | 官方恢复中，或短暂的网络/播放探测失败 | 有界等待，不刷新二维码、不并发重启 |
| `requiresReauth` | 持续 `waiting_qrcode`、快速登录无法恢复、需要验证码/新设备验证、明确授权失效或官方风控验证 | 阻止 Agent 启动，通知 Owner 处理 |
| `blocked/needs review` | `OBS_OUTPUT_INVALID_STREAM`、持续 404/liveStatus=0、凭证有效性或传输结果不明确 | 阻止自动重试，Owner 先检查，不直接认定必须换码 |
| `stopped` | Owner 停止或输出已停止 | 不重放开播，不自动恢复公开推流 |

`OBS_OUTPUT_INVALID_STREAM` 只表示流建立失败，不直接等于凭证过期；持续 404/liveStatus=0 也需要结合房间状态、恢复结果和公开播放证据判断。只有明确授权失效或持续无法恢复登录时才进入 `requiresReauth`，避免把普通配置/网络错误误报为过期。

NapCat 的 `coreReady` 与 `isLogin` 同表达式，不能替代 OneBot 健康检查；`isOffline` 可能在恢复清零期间为 false，不能单独作为告警依据。B 站的 RTMP 连接、OBS reconnect_success、公开播放 decoded 是不同层证据，不能相互替代。

### Owner 必须处理的事情

- NapCat 长期停在 `waiting_qrcode`、需要验证码或新设备验证：手机 QQ 扫码、确认、按提示验证；不要由监控定时刷新二维码。
- 普通 OBS 推流失效：到开播设置页复制本次完整服务器地址和直播码，不只换 `trid`；不把旧 key 当永久配置。
- thirdPartyLive：完成应用/资格/OAuth 入驻及报备，用户每次开播扫码或打开特定 URL 二次确认；风控时到 APP 完成身份验证。
- 发现状态无法恢复时，由 Owner 决定是否停止、换账号/设备或向官方确认，不把“自动重启”当成授权修复。

### 可以自动化的只读工作

- 周期性采集 `isLogin/loginPhase/loginError/isOffline`、OneBot `online/good`、WS 握手和最后成功时间。
- 区分短暂恢复与持续失效，保留每次状态变化及证据时间，不把旧 `lastOpenAt` 或旧 `lastVerifiedAt` 当作当前健康。
- 在 `requiresReauth` 时阻止 Agent 启动/重试，向 Owner 显示下一步操作和原因，不泄露 QR URL、cookie、token、stream key。
- 只在已有有效授权与当次证据下执行受限动作；回调最多三次的幂等处理、startLive/endLive 状态记录、过期与失败告警。

### 明确不能承诺或自动改变的事情

- 不能制造永久 QQ 登录态、永久 OBS key、永久 `live_token` 或永久 `live_key`。
- 不能规定 `trid` 的固定 TTL，不能把 OBS 的 15 分钟退避当作刷新周期。
- 不能用 `signAddress`、MAC、GUID、改设备指纹或 Windows QQ 进程状态推断并规避平台限制。
- 不能用 Cookie 抓取私有接口替代官方授权，不能绕过扫码、二次确认、验证码、风控或商务资格。
- 不能用重连、进程 running、WS open、RTMP Connect 或单帧视频伪造 LIVE/健康。
- 不能将 thirdPartyLive 当成普通 OBS 的通用替代品，也不能把 endLive 当成关闭普通 OBS 场次的通用方法。
- 默认 `autonomous=off`，本调研不开启自治或公开推流。

## 六、需要官方进一步确认的问题

1. 普通 OBS `streamname/key/trid` 是否有独立 TTL，字段何时变化。
2. `grant_url` 的有效期；`expire_in` 的单位与起算点；startLive 超时后的幂等和一次性 token 重试规则。
3. `push_url/live_key` 的有效期、断流重连、跨场复用规则，以及 push_url 在 OBS 中应作为单一 URL 还是拆分服务器/串流密钥。
4. `signAddress` 是否为当前正式配置键，以及同号 NapCat 与 Windows QQ 的具体多端规则。
5. 特殊人群工具的出版物号要求、目标用户范围，以及获批应用的具体编码器接入方式。

在这些问题有书面答案前，工程上按**每次开播新授权、一次性 live_token、当次 push_url/live_key 仅限当次**设计，不承诺无人值守开播或永久凭证。

## 建议的下一步实现

先实现只读 `authHealth` 投影：状态、证据时间、最近成功时间、当前恢复阶段、`requiresReauth`、下一步 Owner 操作和脱敏原因。它只读监控并阻止不合格启动，不自动刷新二维码、不自动刷新推流码、不自动开播。`thirdPartyLive` 在资格与编码器接入方式确认前不实现。
