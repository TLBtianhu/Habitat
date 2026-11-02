# Cutrans 状态伪代码对 Habitat 的启发

来源：`C:\Cutrans\Cutrans-zig0.1\MEMORY.md`

## 1. 声明唯一真源，一切皆投影

Cutrans：内存树是真源，预览、伪代码、AI 视图都是投影。  
Habitat：**AppSession 是真源**，obs、Desktop、Outlet、诊断页都是投影。

结论：不要让 obs 或渲染帧反过来定义应用状态。

## 2. 机制与策略分家

Cutrans：机制无先验，策略即插件。  
Habitat：Core 只负责机制（AppSession、FramePlan、Broker），adapter 负责策略（QQ/B站/MC 的行为）。

结论：Core 更新只该发生在机制变化时，不该因为某个客户端策略变化而更新。

## 3. 流协议：拉取而不是塞入

Cutrans：`Stream<F> = { frames, get(ctx,t)→F, ctx }`，只有拉取，没有塞入。  
Habitat 的像素流也应该这样：

- `present.frame` 由 Outlet/Desktop **拉取**；
- 客户端不主动把帧推给模型；
- 模型只读 obs，不读呈现流。

## 4. 流的赤裸性

Cutrans：流只带顺序时间，fps/单位/语义在消费者，不在流里。  
Habitat：像素流只应是 `frame + timestamp + appId`，分辨率/fps/语义由 Desktop/Outlet 决定。

## 5. 访问与生产分家

Cutrans：produce 与 report 分开，缺帧时不一定要生产。  
Habitat：**不直播时不生产像素**。应用可以运行，但不产生 `present.frame`。这与“桌面渲染是可选应用”完全一致。

## 6. 声明与任务解耦

Cutrans：.cut 声明状态，任务只负责逐帧。  
Habitat：AppSession 声明状态，Renderer 只负责逐帧合成。不要让渲染循环改变 AppSession。

## 7. 树记 id 不记指针

Cutrans：树记 id，不记指针。  
Habitat：AppSession 用 `appId`，不直接持进程句柄；启停由 adapter-host 处理。

## 8. 一 comp 一流，流≠线程≠泵

Cutrans：流是惰性对象，执行借调用方线程；泵是少数长命工人。  
Habitat：不应给每个客户端一个渲染线程；用一个共享 render pump，避免 Chrome/多线程开销。

## 9. 无根合成

Cutrans：没有主时间轴/最终合成，渲染对选中的树求值。  
Habitat：可以有 focused app，但不应把“主画面”当成唯一事实；多个 surface 只是不同投影。

## 10. 身份三域

Cutrans：文档级 id、分发级 name、库级 id 分开。  
Habitat：`appId`（运行时）、`adapter name`（分发）、`asset id`（素材/运行时）分开，不要混用。

## 结论

Cutrans 给 Habitat 最大的启发是：**把“声明”与“呈现”彻底分开**。  
大肥鱼的真实状态是文本事件和 AppSession；像素只是给观众看的投影。  
这与“她不需要用屏幕感知”完全一致：**obs 是她的输入，present 是观众的输出。**
