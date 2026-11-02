# ADR-005：Phase、Capture 与 Outlet 的失败一致性

> 2026-11-02 · 长期目标验收记录：状态转换、桌面捕获权限与编码进程监督。

## 决定

### 1. PhaseMachine 以转换计划替代本地相位回滚

- 使用显式合法转换表；非法转换在外部副作用前拒绝；
- 每次转换有单调 `transitionId`，适配器动作、确认和补偿都带同一 id；
- 进入/离开 CODE 的 world/presenter 动作按执行计划确认，失败时逆序补偿；
- 普通适配器返回 `false / confirmed:false / ok:false` 或抛错都视为失败；
- quiesce 超时后，只有取消得到明确确认才能记录 `quiesce:done`；
- 补偿失败进入 `pendingReconciliation`，禁止继续转换，必须 `reconcile()` 成功才恢复；
- 副作用记录和待对账项可从 `snapshot()` 重建，不依赖调用栈。

### 2. Desktop 打开捕获与读取像素分权

- 旧 `display/server.mjs` 默认拒绝启动，由 `desktop/compositor-service.mjs` 取代；
- `capture/open` 需要 Agent 或 Owner 凭证；
- 每次捕获生成独立随机 token，只在打开时返回一次；读帧和关闭需要该 token，Owner 可管理；
- token 不进入状态列表、QQ 响应或日志；
- CaptureSession 带 `schemaVersion=1`、单调 `revision`、`expiresAt`；过期必须重新申请；
- 请求体、consumer id、surface 数量和未知字段有限制；没有通配 CORS 或未认证 shutdown；
- QQ 屏幕预览只允许 Owner 开、看、关，不能借适配器绕过 Desktop 权限。

### 3. Outlet 由常驻 Supervisor 持有进程身份

- `control/outlet-supervisor.mjs` 是唯一的 Outlet 进程父级和监督者；
- 调用方只提交命令，不再根据 pidfile 杀进程；
- 启动返回 `accepted + instanceId + starting`，不冒充推流成功；`running` 只表示进程存活；
- 停止先 SIGTERM，等待真实退出；超时升级 SIGKILL，再等待退出；仍失败则明确返回 `stop_timeout`；
- Supervisor 重启时旧 running 状态标为 `interrupted`，不根据旧 PID 误杀其他进程；
- systemd 单元启用 `KillMode=control-group`，与 Supervisor 的实例状态共同约束生命周期。

## 实际验收

- SkillRuntime：10/10，Windows 与 WSL 均通过；
- PhaseMachine：16/16，Windows 与 WSL 均通过，包含非法转换、保存/场景/取消失败、补偿失败及 reconcile；
- AppSession/obs/present、Compositor token/expiry、旧 Display 退役：全部通过；
- 真实 HTTP：无 token 拒绝、错 token 拒绝、正确 token 读帧、Owner 管理、schema 拒绝、QQ token 不泄露；
- Supervisor 无副作用测试：实例唯一、停止等待、SIGTERM 无效时 SIGKILL、旧 PID 不误杀；
- 真实 HLS 经新 Desktop 与 Supervisor：H.264 + AAC 正常，停止返回 `exitCode=0`，视频/音频捕获均归零。

## 明确未验证

- 未公开推流到 B 站或任何第三方；
- 未宣称 Worker/VM 已成为操作系统安全沙箱；
- 未做真实第三方技能、真实 RTMPS、真实 QQ 视频传输验收；
- PhaseMachine 尚未直接接入主 AgentLoop，当前先以其独立失败矩阵作为接入门槛。
