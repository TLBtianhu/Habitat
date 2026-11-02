# WSL 环境分离：开发态与用户态

> 2026-10-31 · 与 Windows 分发环境同一条规则：**正式运行不碰开发目录。**

## 目录约定

### 开发态（只用于写代码/实验）

```
/opt/habitat/dev/habitat/       # 源码、试验、模组开发
/opt/habitat/work/              # 临时构建与实验产物
```

### 工具链（可被多个环境共享，但不是开发源码）

```
/opt/habitat/runtime/jdk25          # 原生 JDK
/opt/habitat/runtime/node22         # 原生 Node
/opt/habitat/runtime/deps           # 原生运行库
```

### 用户态（正式运行）

```
/opt/habitat/app/             # 安装的程序文件（只读）
/etc/habitat/                 # 配置：worlds.json、客户端清单、身份引用
/var/lib/habitat/
  world-server/               # MC 服务端与存档
  artifacts/                  # 运行状态、会话、观测
  cache/tts/                  # 可删除的本地 WAV 缓存
  utterances.jsonl            # Utterance 与合成状态，重启恢复
  outbox/                     # 稳定 intent、终态、迟发结果与 interrupted
  memory/                     # 分 residence 的 JSONL 持久记忆（含 TTL/脱敏）
  episodes/                   # 当前 Episode 的 checkpoint、参与者与 pending writes
  after-action.jsonl          # 任务后自评与证据验收记录
  pump/                       # 事件泵水位、死信与连接状态
  system-chat.jsonl           # 系统对话，升级保留
  agent-system-chat.json      # Agent 已读水位
  logs/                       # 日志
/tmp/habitat/                 # 临时文件
```

## 规则

- 开发态可以随便改、随便删；
- 用户态的 `app` 只能由安装器更新，运行时不许往里写；
- 世界存档、会话、日志、身份都在 `/var/lib/habitat` 或 `/etc/habitat`；
- **正式验收必须从 `/opt/habitat/app` 启动**，不能从 `/opt/habitat/src` 启动。

## 当前迁移进度

- 世界服务端目标：`/var/lib/habitat/world-server`；
- bot / body / display / identity 目标：`/opt/habitat/app`；
- 配置文件目标：`/etc/habitat`；
- 剩余工作：清除 `/opt/habitat/src` 依赖，改成安装器分发。
