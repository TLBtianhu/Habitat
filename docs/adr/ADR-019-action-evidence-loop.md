# ADR-019：AfterAction → Episode → SkillLibrary 动作证据闭环

> 2026-11-02 · 动作是否成功由真实证据决定，不由自评或 HTTP accepted 决定。

## 实现

- `ActionTracker` 在副作用前写入并保存 Episode `pendingWrites`；
- 结果产生后保存最小证据引用，例如 utteranceId、instanceId，不把完整文本或秘密写入技能库；
- `voice.speak` 核验合成状态与真实播放事件；合成 ready 但没有播放完成证据时保持 unknown；
- HLS 启动核验 instanceId、进程、capture、真实帧、playlist 和可选音频捕获；
- HLS 停止核验进程退出、管线 stopped 状态以及 Desktop/Audio 捕获关闭；
- 后台核对只读取证据，不重放副作用；重启时先恢复已有 AfterAction 报告，再做在线核验；
- `SkillLibrary` 只接受 `verified_success` 且 Episode 已确认的步骤，保存动词、参数名和证据报告 id，不生成可执行代码。

## 实际验收

- 离线覆盖 pending、unknown、verified_partial、verified_failure、verified_success、迟到成功和崩溃恢复；
- 真实 HLS 启动与停止均为 `verified_success`，两项分别进入 SkillLibrary；
- 真实 Kokoro 合成产出 74894 字节 WAV，但没有播放完成事件，因此结果为 unknown；
- 修复 Audio Mixer 将请求 close 误当流断开的问题，以及旧实例帧可能污染本次验收的问题；
- 可选检查成功不再被误降级为 partial。

## 边界

- `unknown` 不允许进入 SkillLibrary；
- 没有证据引用的 pending 只能等待，不能盲目重试；
- 该 SkillLibrary 是已验证步骤目录，不是任意代码执行器；实际代码技能仍需签名制品与隔离运行时审核。
