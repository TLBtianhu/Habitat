# MC 模组工具链（WSL）

> 2026-10-31 由子代理实测建立。目标：**离线出包 4 秒**。

## 1. 装了什么

| 组件 | 版本 | 位置 |
|---|---|---|
| JDK | **Temurin 25.0.5+8** | `~/opt/jdk25`（303 MB，无 root） |
| Gradle | **9.2.1** | wrapper（`~/.gradle/wrapper`，144 MB） |
| 依赖缓存 | —— | `~/.gradle`（**2.2 GB**） |
| 示例工程 | MC 26.3 + NeoForge 26.3.0.100 | `~/work/tutorialmod` |

## 2. 网络：必须分域名走

| 目标 | 代理 7897 | 直连 |
|---|---|---|
| `api.adoptium.net` | ✗ TLS reset | ✓ |
| `piston-meta.mojang.com` | **✗ 必失败** | ✓ |
| `maven.neoforged.net` | **✓ 必须走** | ✗ 超时 |
| `services.gradle.org` / `repo1` / `plugins.gradle.org` | 均可 | 均可 |

**必加的一行**（建议同步进所有模组工程模板）：

```properties
systemProp.http.nonProxyHosts=piston-meta.mojang.com|*.mojang.com|localhost|127.0.0.1
```

## 3. 构建

```bash
export JAVA_HOME=$HOME/opt/jdk25
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 \
                    -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897"
cd ~/work/tutorialmod
./gradlew build            # 首次 3m26s（neoForm 反编译 MC）
./gradlew build --offline  # 之后 3~17s
```

产物：`build/libs/tutorialmod-1.0.0.jar`（18,239 B）。

## 4. 两个坑（都实测过）

1. **项目内 `.gradle/` 不能删。** NeoGradle 把 MC 版本清单缓存在 `<项目>/.gradle/caches/minecraft/`，不在 `~/.gradle`。删了它就离线失败：
   `Could not find the file: …/.gradle/caches/minecraft/versions/26.3/metadata.json and we are offline.`
2. **`piston-meta.mojang.com` 走代理会挂**，必须用上面的 `nonProxyHosts` 绕开。

## 5. 结论

> 依赖在 `~/.gradle`（2.2 G），**保留项目内的 `.gradle/`**，删 `build/` 后 `./gradlew build --offline` **4 秒出包**。
> 换机器、或删过项目 `.gradle/`，就必须联网跑一次。

## 6. 与 fishbowl 的关系

- 这是**宿主/WSL 双可跑**的工具链；沙箱规则要求"编译在一次性实例"，所以构建**先放 WSL 用户目录**，产物再拷进服务器实例。
- 我们的世界钉 **MC 26.1 + NeoForge 26.1.x**（mineflayer 上限），不是教程的 26.3 —— 换版本时只需改三行 gradle 属性并联网重跑一次。
- 原始报告：[tools/REPORT.md](../tools/REPORT.md)
