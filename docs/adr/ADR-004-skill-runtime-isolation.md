# ADR-004：SkillRuntime 按技能隔离与转换串行化

> 2026-11-02 · 对应跨项目复核中 Habitat 的第一项 P0。

## 问题

旧实现存在三个真实风险：

1. `_collectGarbage(exceptKey)` 会终止其他技能的活槽，激活或回滚 A 可能误杀 B/C；
2. 每次 `call()` 都新增 message 监听器，超时后不移除，永不返回或迟发的调用会积累；
3. 同一技能的激活、回滚和崩溃回调可以交错，旧代操作可能覆盖更新代。

## 决定

- 垃圾回收只作用于同一技能 id 的旧槽，其他技能不参与；
- 每个 Worker 槽只有一个统一消息分发器，调用以 `callId` 注册到 `slot.pending`；
- 超时、drain、worker exit、dispose 都结算并删除 pending；迟发结果只记录 `call:late`，不覆盖新结果或新槽状态；
- 同一技能的 activate/rollback 进入独立 Promise 队列，按请求顺序完成；
- 转换期间旧槽崩溃只记录 `unhealthy:ignored_transition`，不允许旧代回滚覆盖新激活；
- init 超时移除初始化监听器，并保留旧槽可用。

## 验证

Windows 与 WSL 均运行 `runtime/skill-runtime.test.mjs`，10/10 通过：

1. 基本激活、能力调用与拒绝；
2. 坏 artifact 不切换；
3. 崩溃自动回滚；
4. 连续 30 代不泄漏；
5. A/B/C 多租户互不影响；
6. 超时 pending 清理、迟发结果与监听器稳定；
7. 并发激活保持请求顺序；
8. 转换期间旧槽崩溃不覆盖新代；
9. drain 结算挂起调用；
10. init 超时不误杀旧槽、不残留监听器。

这些是实际执行结果，不是静态推断。未进行第三方技能的真实沙箱安全验收；Worker 仍只是运行时隔离机制，不等于 OS 安全边界。

## 下一步

按复核顺序进入 PhaseMachine：合法转换表、transitionId、外部副作用确认与补偿。通过失败矩阵前，不把 PhaseMachine 直接接入主 AgentLoop。后续验收见 [ADR-005](ADR-005-failure-consistency.md)。
