# 可选桌面合成器：文字声明、Surface 与捕获会话

> 2026-11-01 · 修正“obs 不含像素，像素只给 present”的过度简化。
> 核心不是把世界劈成两半，而是：**语义声明始终存在，像素链路按需接通。**

## 1. 不变量

1. 每个应用始终向 Core 返回文字版状态声明，与桌面是否开启无关。
2. Desktop Compositor 是一个**系统级、可被 AI 操控的 AppSession**，不是直播模块的私有渲染函数。
3. 只有合成器开启、应用 Surface 可见、并且存在实际输出需求时，应用才需要生产像素。
4. AppSession 保存声明，不保存图像字节；obs 保存给模型的语义投影，不转发桌面帧。
5. 桌面合成与编码推流必须分开。HLS/RTMP、QQ 屏幕共享、本地预览都是平等的捕获消费者。

## 2. 两条应用接口

```ts
interface AppAdapter {
  // 始终可用；返回状态、事件、能力、错误，不含桌面像素。
  describe(): TextDeclaration;

  // 可选；合成器按可见性与输出需求attach后才开始生产。
  attachSurface?(request: SurfaceRequest): SurfaceHandle;
  detachSurface?(surfaceId: string): void;
}
```

Surface 中传递的是帧引用、序号、时间戳、尺寸、格式与损坏区域，不是把 PNG/JPEG 塞进 AppSession。

## 3. Desktop 是生产者，也是服务提供者

```text
MC / QQ / IDE / 直播UI ──文字声明──► Core ──obs──► AI
       │
       └────按需提供应用 Surface──► Desktop Compositor
                                          │
                                          ├──► 本地显示
                                          ├──► QQ 屏幕共享捕获
                                          ├──► 直播编码捕获
                                          └──► 其他获批消费者
```

Desktop 自己也有 `describe()`：当前焦点、布局、Surface 列表、开启状态、消费者列表、帧率与错误都应能被 AI 读取和操控。

## 4. QQ 与直播为什么具有双向关系

它们有两套独立身份：

- **窗口生产者**：自己的控制界面可以作为 Surface 出现在桌面里；
- **画面消费者**：通过 CaptureSession 订阅整个桌面、某个窗口或某个虚拟显示器。

“消费者”不等于 Outlet 专属角色。本地预览、截图、AI 主动请求的一张视觉辅助图，也都是不同预算的 CaptureSession。

## 5. 必须显式处理回环

QQ 共享整个桌面，同时自己的窗口也在这个桌面里，天然可能形成“画中画无限回环”。

CaptureSession 必须声明：

```jsonc
{
  "source": { "kind": "display", "id": "main" },
  "excludeSurfaces": ["qq"],       // 默认排除捕获者自己的窗口
  "cursor": "metadata",
  "fps": 15,
  "size": [1280, 720]
}
```

需要艺术性的回环效果时，才明确选择上一帧递归；默认不允许隐式自捕获。直播软件的场景/节目输出与它的控制窗口也应是不同 Surface，避免把节目输出无意接回输入。

## 6. 生命周期与省资源规则

- Desktop 关闭：文字状态照常，Surface 与捕获帧不存在。
- Desktop 开启但无显示、无捕获消费者：保留声明与布局，暂停像素帧泵。
- 有消费者：建立一个共享帧泵，按消费者需求合成；旧帧可丢弃，不排队积压。
- 最后一个消费者离开：停止编码与像素生产，不停止 QQ、MC 等业务进程。
- AI 可以请求开关 Desktop；涉及屏幕捕获、对外直播的权限仍按主人授权策略执行。

“每一瞬间检查”在实现上应是**开关时建立订阅，帧泵按需求拉动**，不是每帧轮询所有应用。

## 7. 当前实现（2026-11-01）

已经完成第一版拆分：

1. `desktop/compositor-service.mjs`：独立 Desktop 服务，`127.0.0.1:9260`；
2. `desktop/compositor-runtime.mjs`：Surface 生命周期、CaptureSession、共享帧泵与排除自捕获；
3. `desktop/surface-provider.mjs`：MC 文件帧 Provider，只有 attach 后才读取，并拒绝超过 3 秒未更新的旧帧；
4. `tools/pipeline.mjs`：纯 HLS/RTMP 编码消费者，不再包含 Chrome、SVG 桌面或待机帧渲染；
5. `control/outlet-supervisor.mjs`：唯一持有 Outlet 子进程身份；`control/outlet-host.mjs` 只提交启停命令，启动返回 accepted，停止等待真实退出；
6. `adapters/qq/server.mjs`：复用同一 CaptureSession，默认排除 QQ 自身 Surface；Owner 才能打开、读取和关闭预览；
7. RTMP/RTMPS 使用同一纯消费者管线，目标只从主人配置读取，公开启动必须经主人直接操作或任务批准；
8. 捕获权限与协议：`capture/open` 需要 Agent/Owner 凭证，读帧和关闭需要每次捕获独立 token；`schemaVersion=1`、单调 `revision`、`expiresAt`，token 不进入状态或日志；
9. 旧 `display/server.mjs` 已退役并默认拒绝启动。

核心接口：

- `GET /status`：Desktop 的文字声明；
- `POST /capture/open`：需要 Agent/Owner 凭证，返回一次 captureToken；
- `POST /capture/close`：需要该捕获 token，Owner 可管理；
- `GET /capture/frame?id=...`：需要该捕获 token；只返回未过期的当前合成帧，并带 revision 与 expiresAt。

验证覆盖：无消费者不产帧、多个消费者共享 Surface、QQ 排除自捕获、桌面关闭停帧、最后一个消费者离开停帧，以及真实 HLS 播放。

**尚未接入**：QQ 视频通话的实际传输。OneBot 没有标准屏幕共享接口，当前 QQ Adapter 提供的是真实桌面捕获和本地预览，不能宣称 QQ 视频已接通。

## 8. 调研依据

- Wayland：合成器就是显示服务器；应用渲染自己的 buffer，合成器依据 scenegraph 与 damage 合成最终屏幕。
  https://wayland.freedesktop.org/architecture.html
- Windows DWM：合成开启时，各窗口先绘制到离屏 surface，再由 DWM 合成桌面图像；文档也明确其作为可启停服务的历史形态。
  https://learn.microsoft.com/en-us/windows/win32/dwm/dwm-overview
- Xvfb：显示服务可以完全没有物理显示器，只在内存中维护 framebuffer，证明“桌面存在”不等于“接管宿主屏幕”。
  https://xorg.freedesktop.org/archive/X11R7.6/doc/man/man1/Xvfb.1.xhtml
- XDG ScreenCast Portal：捕获是有生命周期的会话，显式选择 monitor/window/virtual source，再向消费者提供流；适合作为 QQ/直播 CaptureSession 的参考。
  https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html
