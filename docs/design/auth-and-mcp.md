# QQ / B站 / MC 正版授权与 DSH MCP 技术路线

> 2026-10-31

## 1. QQ：OneBot 协议客户端

**路线**：NapCat / go-cqhttp / Lagrange 作为独立后端，Habitat 通过 OneBot HTTP + WebSocket 接入。

```ts
interface QqClient {
  getLoginInfo(): Promise<{ uin: number; nickname: string }>;
  sendGroupMsg(groupId: number, text: string): Promise<void>;
  sendPrivateMsg(userId: number, text: string): Promise<void>;
  onEvent(cb: (e: OneBotEvent) => void): void;
}
```

- 不注入、不开 QQ 窗口；
- 后端只负责协议与登录，Habitat 负责事件队列、限频、权限与审计；
- 授权：后端扫码登录，Habitat 的 Identity Hub 只记录 `uin/nickname` 与后端地址，不重复保存 cookie。

## 2. B 站：扫码 OAuth

已实现 `identity/providers/bilibili.mjs`：

- `qrcode/generate` 生成二维码；
- `qrcode/poll` 轮询状态；
- 成功后取 `SESSDATA`，写 `/etc/habitat/bilibili.json`（600）；
- 身份记录不存明文。

B 站客户端随后用该配置读弹幕/评论/直播间事件，直播推流用独立 Outlet。

## 3. MC 正版：Microsoft device-code

流程：

1. `login.microsoftonline.com/.../devicecode` 获取 `user_code` 与 `verification_uri`；
2. 用户去网页确认；
3. 轮询换取 Microsoft token；
4. Xbox Live → XSTS → Minecraft `login_with_xbox`；
5. 写入 `/etc/habitat/mc-online.json`（600），只存 token 与过期时间，不存密码。

需要用户在 manifest 里提供 **Azure 应用的 clientId**（公共客户端，不需要 secret）。离线服继续使用 `offline` manifest，不强迫正版。

## 4. DSH MCP 插件

每个 AI 客户端都可以是一个 **stdio JSON-RPC MCP server**。已实现 `mcp/mc-server.mjs`：

```
initialize
tools/list  → mc.obs / mc.walk / mc.dig / mc.say
tools/call  → 桥 /obs 与 /cmd
```

设计规则：

- MCP 只暴露**闭集动作与观测**，不暴露任意 shell；
- DSH 负责心智与编排，MCP 客户端负责协议与执行；
- 权限由 Identity Hub 的 scope 与 AgentLoop 的 policy 共同约束；
- 后续 QQ/B站也用同样的 MCP 包装，客户端可热装卸。

## 5. 当前进度

- B 站扫码：已通；
- DeepSeek key 统一授权：已通；
- MC MCP server：已通；
- QQ OneBot 客户端：待接后端；
- MC 正版 device-code：待实现。
