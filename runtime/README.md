# Habitat 运行时包

当前核心运行时测试包托管于 GitHub Releases：

- `habitat-runtime-core-0.1.1.tar.gz`：<https://github.com/TLBtianhu/Habitat/releases/download/runtime-v0.1.1/habitat-runtime-core-0.1.1.tar.gz>

0.1.1 额外包含 Chrome 所需的 31 个共享库及逐文件 SHA256，不能依赖宿主系统库。

`lock.json` 固定平台、版本、组件和哈希；`sbom.json` 记录组件、许可证和分包边界；`lock.sig.json` 是 lockfile 的 Ed25519 签名；`revocations.json` 用于撤销不再允许的包。

```bash
# 验证 lock、SBOM 和签名
node tools/verify-runtime-lock.mjs

# 仅发布者在本机签名；私钥不进入仓库
node tools/sign-runtime-lock.mjs
```

签名私钥默认在 `/etc/habitat/release-signing-private.pem`（mode 600）。公开仓库只包含公钥和签名，不包含私钥。

运行时按 core/media/voice/app 分包，不能用“最新版本”覆盖 lockfile。FFmpeg 当前是独立 media 依赖，不包含在 core 测试包中。新增运行时版本必须重新生成 SBOM、签名、撤销检查与干净目录安装验收。
