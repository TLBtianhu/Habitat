# 运行时管理

## 不依赖系统自动更新

运行时不直接调用用户的 JDK、npm、pip 或“最新版本”。构建期可以从官方源/镜像取得输入，但发行时固定：

- 精确版本、平台、架构、ABI、SHA256、签名与 SBOM；
- Node、JDK、Python、Chrome、FFmpeg、ONNX Runtime、Kokoro 和 npm 依赖的兼容组合；
- staging 下载、完整性与安全路径校验、健康检查、失败回滚；
- 官方源仅作输入，运行时由 Habitat 统一管理，用户系统更新不会悄悄改变它。

## 分包边界

- 'core-runtime'：Node、核心 npm 依赖和必要本地库；
- 'media-runtime'：Chrome/FFmpeg/Resvg；Chrome 所需共享库也随包分发并逐文件校验，不依赖宿主系统库；
- 'voice-runtime'：Python/sherpa-onnx/Kokoro；
- 'app-runtime'：QQ/B站/MC 等应用插件的独立依赖。

本体 MIT 不等于这些运行时统一 MIT；每个包带自己的许可证、NOTICE 和必要的源代码/下载信息。
