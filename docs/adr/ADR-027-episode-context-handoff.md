# ADR-027：跨场所 Episode 与受控上下文交接

> 2026-11-03 · 同一个人格可以跨场所继续任务，但同步的是任务状态，不是全部社交记忆。

## 决定

- Episode 增加单调 `revision`：checkpoint、参与者、暂停/恢复、结束和 pending write 状态变化都会推进；
- `originResidenceId` 永远记录任务来源，不因后续场所变化而改写；
- 只有 owner 能通过 `handoffTo` 把新 residence 加入当前 Episode，普通群友不能凭一句话接管任务；
- handoff 记录 from/to、owner、摘要和时间，不允许在已结束 Episode 上继续交接；
- MemorySlice 对外只提供 `Episode.summary()`，不展开原始 pending writes 或其参数；
- 摘要中的 checkpoint 仅允许 phase、currentTask、activeResidence、mcAvailable、bilibiliAvailable；
- QQ/B站/MC/控制台各自社交记忆仍按 residence 隔离，交接不会附带控制台或其他场所私聊。

## 实际流程

1. 控制台创建并推进当前 Episode；
2. owner 在 QQ 中明确参与后，QQ residence 才获得该任务的可读摘要；
3. MC 继续读取同一 Episode 与 revision，但看不到 QQ 或控制台私有社交记忆；
4. 重启后恢复同一 origin、handoff、revision 和当前任务，不重复执行已确认动作。

## 实际验收

- revision 随 checkpoint 和状态变化递增；
- 非 owner 交接被拒绝；
- 控制台→QQ→MC 共享同一任务，重启后 revision 保留；
- pending 参数与 checkpoint 额外字段不进入摘要；
- QQ 看不到控制台私聊，MC 看不到 QQ 私有社交记忆；
- 现有 AfterAction、恢复、插件运行时和安装版设置测试继续通过。
