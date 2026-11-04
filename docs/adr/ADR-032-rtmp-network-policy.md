# ADR-032: RTMP 网络策略与凭证健康

日期：2026-11-05
状态：Accepted（本地 SOCKS5、真实 Clash 握手、直连预检和当前播放验证通过）

## 决策

RTMP 推流与 API 请求分开处理。默认 `live-push.bilivideo.com` 直连，API 可以使用系统 HTTP 代理。用户选择 `system` 推流模式时必须显式设置 `allowSystemProxyForRtmp=true`，否则 `supported=false` 且禁止启动。

`RtmpNetworkPolicy` 支持三种模式：

- `direct`：清理 RTMP 子进程代理环境，强制直连。
- `system`：仅在用户明确允许后使用系统代理。
- `socks5`：使用根目录内 `Socks5Relay`，只监听回环地址，不改系统代理、路由或防火墙。

API 代理使用同一 undici 版本的 `fetch + ProxyAgent`，避免 Node 全局 fetch 与外部 Dispatcher 不兼容。

## 预检与凭证健康

预检只验证 DNS、TCP 或 SOCKS5 握手，不启动推流，不证明直播成功。返回 `reachable/degraded`、`lastCheckedAt` 和脱敏错误。

`BilibiliLiveSettings.credential` 分离：

- `configured`：配置存在。
- `applied`：输出进程运行。
- `verified`：独立播放验证成功且未过期。
- `canStart`：配置、网络支持且输出未运行；预检 degraded 或 system 未启用时为 false。
- `requiresRefresh`：失败、过期、网络不支持或存在错误。
- `state`：`unconfigured/configured/applied/verified/reconnecting/degraded/stale/stopped`。
- `lastCheckedAt`、`lastVerifiedAt`、`networkMode`、`networkState`、`outputState`、`verificationState`。

`streamKey` 和 SOCKS5 密码只写入 `600` 权限文件，接口只返回 `streamKeySet`、`proxyConfigured`、`hasProxyAuth` 等布尔状态，不回显秘密。

## 生命周期

- `BilibiliRtmpOutput.start()` 选择路由并启动对应传输。
- SOCKS5 转发随输出退出、异常和 owner 停止关闭。
- 预检与真实播放验证互不替代；`verified` 只能由独立播放解码获得。
- 不支持把 TCP 可达、FFmpeg 启动或旧播放证据当作当前直播成功。

## 验证

- `stream/verify-network-policy.mjs`：本地 SOCKS5 实际转发、预检、系统代理开关、HTTP API 代理和秘密不回显。
- `stream/verify-real-socks5.mjs`：真实 Clash SOCKS5 握手。
- `stream/verify-network-live.mjs`：直连预检和当前真实播放验证。
- `control/verify-bilibili-settings.mjs`：owner 网络配置、预检、凭证健康和 Live 页面。
- `stream/verify-rtmp-reconnect.mjs`：异常重连与 owner 停止。
- 测试结束后关闭转发、恢复代理环境变量，不影响其它测试。
