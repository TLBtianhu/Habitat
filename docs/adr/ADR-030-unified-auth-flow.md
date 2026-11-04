# ADR-030: 控制台统一认证刷新流程

日期：2026-11-04
状态：Accepted（核心控制器与 NapCat 实现已验证；控制台页面接入待完成）

## 目标

控制台提供一个统一认证入口，而不是为 QQ、NapCat、Bilibili 或 MC 分别维护一次性排障脚本。用户点击刷新后，页面只显示当前后端返回的图像和状态，不猜测旧二维码或旧登录状态。

## 核心流程

1. 选择认证提供者。
2. 读取当前后端状态：`ready`、`auth_required`、`connecting` 或 `awaiting_scan`。
3. 未就绪时刷新当前认证材料。
4. 对需要二维码的提供者，取得当前登录 URL，并在本地生成 PNG。
5. 返回本次 `state`、图像和 `checkedAt`，不返回 token、Credential、账号标识或历史二维码。

`ready` 只能来自当前后端状态，不能来自“刷新接口返回成功”、HTTP 200、二维码文件存在或旧缓存。

## NapCat 实现

`control/auth-flow.mjs` 使用当前 NapCat WebUI `/api`：

- token hash → `/auth/login` 获取临时 Credential。
- `/QQLogin/CheckLoginStatus` 判断真实登录状态。
- `/QQLogin/RefreshQRcode` 获取当前登录 URL。
- 使用本地 `qrcode` 库生成 PNG，避免把登录网页当成图片，也避免外部二维码服务。

每次刷新都重新读取后端事实，不复用上次 Credential、二维码或状态。二维码数据只给 owner 的认证流程使用，不写公开日志、仓库或公开接口。

## 控制台边界

后续控制台页面和 owner-only 接口直接调用 `AuthFlowController.status()` 与 `refresh()`，不复制 NapCat 的鉴权和二维码算法。其他提供者在有真实实现后加入，不能用模拟状态补齐统一页面。

## 验证

- `control/verify-auth-flow.mjs`：凭证交换、刷新、状态判断、图像生成和秘密不泄露。
- 真实 NapCat 刷新已生成可扫描 PNG。
- 扫码后必须再次验证 NapCat `loggedIn` 与 Habitat QQ `ready`，才算恢复完成。
