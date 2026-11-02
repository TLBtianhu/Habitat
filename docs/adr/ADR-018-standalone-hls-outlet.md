# ADR-018：独立 HLS Outlet 插件

> 2026-11-02 · HLS 作为独立 outlet 包发布，Desktop/Audio 保持 Core 服务能力。

## 边界

- HLS 包只包含 manifest、启动脚本和编码管线；
- `requires` 明确声明 `desktop.capture` 与 `audio.capture`；
- 不复制 Desktop、Voice、Audio 实现，不启动公网推流；
- 启动脚本相对自身定位，运行数据写入 `HABITAT_DATA_DIR`，不写插件目录；
- Node 可执行文件由 Outlet Supervisor 通过 `HABITAT_NODE=process.execPath` 传入，继承当前锁定运行时；
- `outlet-resolver` 校验安装状态、撤销状态、manifest、普通文件与目录边界；
- owner/root 安装时，安装器将缓存、运行时代码和状态文件归还给既有 Habitat 服务账号。

## 实际验收

- 独立 HLS 包解包、权限、入口和依赖声明验证通过；
- 已安装 Outlet 的目录边界、停用/撤销与内置回退规则测试通过；
- 通过 PluginRegistry 启动安装包，子进程 cwd 为 `/var/lib/habitat/plugins/installed/hls`；
- Desktop capture 真实建立，产出 27 帧和有效 HLS playlist；
- 停止后 Outlet 返回 `state=stopped`、`exitCode=0`，没有活动 RTMP 或公网推流。

## 发行

- 插件版本：`hls 0.1.1`；
- 发布：`plugins-v0.1.4`；
- 安装：`node tools/install-plugin.mjs hls`；
- 启停仍由 owner/agent 的现有 Outlet 权限控制，安装不等于自动开播。
