# 身份中心（Identity Hub）：插件自描述，账号统一绑定

> 2026-10-31 · 对应问题：QQ / MC / 直播客户端都要账号，逐个做绑定界面太烦；客户端又是插件，界面必须能自动扩展。

## 1. 她首先是独立意识体，客户端只是可插拔的器官

- `AgentLoop` 是主进程，事件驱动、长生命周期；
- `mc / live / qq / browser / ide` 都是可装卸的 MCP 客户端；
- **开播、玩 MC、上 QQ 是三件独立的事**：`streaming`、`worldId`、`qqSession` 三个状态位；
- 她可以只玩游戏不开播、只开播不玩游戏、被你在 MC 里说“开播吧”后自己决定。

## 2. 统一身份中心，而不是每个客户端一套登录页

```
┌──────────────────── Identity Hub（可信薄服务）────────────────────┐
│ 客户端身份清单 → 自动生成绑定界面 → 绑定/刷新/注销/测试 → 凭证库     │
└───────────────────────────────────────────────────────────────┘
        ▲ 只发 identityId / 短期 token            │ 不泄露原始密钥
        │                                         ▼
   AgentLoop / MCP 客户端                     QQ / MC / 直播平台
```

**原始凭证只住在 Identity Hub。** 客户端拿到的是 `identityId` 和按 scope 签发的短期 token。

## 3. 插件只写一份清单，界面自动出现

```jsonc
// clients/qq/identity.manifest.json
{
  "client": "qq",
  "provider": "qq-bot",
  "kind": "qrcode",                 // qrcode | oauth | cookie | offline | token
  "displayName": "QQ 机器人账号",
  "scopes": ["qq.read", "qq.send"],
  "fields": [
    { "key": "uin", "label": "QQ 号", "type": "text", "required": true }
  ],
  "loginFlow": "qrcode",
  "refreshPolicy": "on-401",
  "secretRef": "qq/main"
}
```

```jsonc
// clients/mc/identity.manifest.json
{
  "client": "mc",
  "provider": "microsoft",
  "kind": "oauth-device",
  "displayName": "Minecraft 正版账号",
  "scopes": ["mc.join", "mc.chat", "mc.action"],
  "loginFlow": "device-code",
  "secretRef": "mc/main"
}
```

```jsonc
// clients/live/identity.manifest.json
{
  "client": "live",
  "provider": "bilibili",
  "kind": "cookie",
  "displayName": "B 站直播账号",
  "scopes": ["live.read", "live.write", "live.push"],
  "fields": [
    { "key": "sessdata", "label": "SESSDATA", "type": "secret", "required": true }
  ],
  "secretRef": "live/bilibili"
}
```

**新增一个客户端 = 新增一份 manifest + 一个 provider 插件。身份中心的 UI 不需要改。**

## 4. 统一身份记录格式

```ts
type IdentityRecord = {
  identityId: string;        // 稳定 id：qq/main、mc/main、live/bilibili
  client: string;            // qq / mc / live
  provider: string;
  displayName: string;
  scopes: string[];
  secretRef: string;         // 指向凭证库，不是凭证本身
  status: 'unbound'|'binding'|'bound'|'expired'|'revoked';
  expiresAt?: number;
  metadata?: Record<string, unknown>;  // 昵称、头像 URL、服务器白名单等
};
```

所有客户端共用这一种记录，列表、详情、状态、测试按钮都能统一渲染。

## 5. 绑定流程也统一成四种

| 流程 | 用在哪 | 中心做什么 |
|---|---|---|
| `qrcode` | QQ、B 站 | 生成二维码 → 轮询扫码状态 → 入库 |
| `oauth-device` | MC 正版 | 给设备码 → 用户去网页确认 → 换 token |
| `cookie` | 直播平台 | 粘贴 cookie → 校验有效 → 入库 |
| `offline` | 离线 MC | 只填昵称，不需要密码 |

界面只需要一个页面：**客户端列表 + 状态 + 绑定/重绑/注销/测试**。具体字段由 manifest 渲染。

## 6. 客户端怎么用身份

```ts
const grant = await identityHub.issue({
  identityId: 'live/bilibili',
  scopes: ['live.read', 'live.push'],
  ttlSec: 900,
});
// grant.token 只带这两个 scope，过期自动失效
```

- `streaming=false` → 不签发 `live.*`；
- `worldId=none` → 不签发 `mc.*`；
- 她只能申请自己声明过的 scope，**不能顺手拿 QQ 的权限去干直播的事**。

## 7. 部署形态

- **Linux 服务器**：Identity Hub + AgentLoop + MCP 客户端都作为长驻服务；账号一次绑定，长期有效；
- **自己电脑**：同样，只是多了“启动”这一步；
- **Android**：客户端可以是本地 MCP，但身份中心可以在服务器上，客户端只拿短期 token，不存原始账号。

## 8. 与现有代码的映射

| 现在 | 目标 |
|---|---|
| `worlds.json` 只管世界地址 | 世界连接仍需 `identityId`（离线可空） |
| `provider.worlds.mjs` | 连接前向 Identity Hub 申请 `mc.join` |
| `live` 客户端未实现 | 先写 manifest，再接身份中心 |
| `qq` 客户端未实现 | 同上，复用现有 DSH 接 QQ 的桥 |
| 凭证散落环境变量 | 全部收进 Identity Hub，客户端只见 `identityId` |

## 10. 授权绑定怎么做最顺

### 10.1 优先级

1. **扫码 / 设备码**：QQ、B站、Microsoft 都优先走这条。用户不掏密码，体验最好。
2. **Cookie 导入**：只作兜底，导入后立即校验、显示昵称头像、标记过期时间。
3. **账号密码**：尽量不做；实在绕不开才做，并且只进凭证库，不进日志。

### 10.2 一次绑定的完整体验

```
选择客户端 → 选登录方式 → 扫码/设备码/粘贴 cookie
   → 中心校验 → 显示昵称头像和权限范围 → 只读测试 → 保存
```

绑定成功后用户看到的不是一串 token，而是：

```
Bilibili · 大肥鱼
权限：读弹幕、发弹幕、推流
状态：已绑定 · 有效期至 2026-11-30
[测试] [重绑] [注销]
```

### 10.3 多账号槽位

`identityId = client/slot`，例如：

- `qq/main`、`qq/alt`
- `mc/main`、`mc/test`
- `live/bilibili`、`live/douyin`

每个世界/群/直播间可以选择用哪个身份，**身份不绑定群或服**。

### 10.4 过期与刷新

- 后台自动刷新；401/失效时只暂停对应客户端，**不拖垮整个人格**；
- 状态机：`unbound → binding → bound → refreshing → expired → revoked`；
- 过期时给一键重绑，不让用户重新填所有字段。

### 10.5 权限要"说人话"

绑定页不显示 `live.push`，显示"允许她把画面推到你的直播间"。
高风险 scope（推流、发消息给陌生人、进公开服）单独列出，必要时二次确认。

### 10.6 API 形态

```
GET  /identity/list
POST /identity/begin      { client, provider, flow }
POST /identity/poll       { bindingId }
POST /identity/revoke     { identityId }
POST /identity/issue      { identityId, scopes, ttlSec }
POST /identity/test       { identityId }     // 只读测试
```

绑定过程用一次性 `bindingId`，绑定页只监听本机回环，密钥不进前端存储、不进日志。

### 10.7 迁移

换机器/上服务器时，导出**加密身份包**（不含明文），在新机器上导入后逐个重新校验；不允许直接复制明文 cookie 文件。

---

最省心的原则：**让用户只扫码，让你只管 secretRef，让她只拿短期 token。**

## 11. 一句话

> **客户端插件化，身份也插件化；但绑定界面、凭证保管、scope 签发必须统一。**
> 这样她可以有任意多个客户端，而你只需要面对一个“账号中心”。
