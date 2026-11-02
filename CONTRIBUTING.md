# 贡献指南

1. 使用独立开发目录，不把构建产物、用户数据或真实账号配置带入提交。
2. 运行 'node agent/verify-episode.mjs'、'node agent/verify-memory-slice.mjs'、'node adapters/verify-plugin-registry.mjs'。
3. 新增插件必须提供 manifest、provider、权限、生命周期、配置 schema、错误语义和测试。
4. 不默认开启公网推流、任意群发送、Shell、文件写入或宿主显示/输入控制。
5. 代码贡献默认采用 MIT；第三方代码、模型、角色和插件必须单独注明许可证，不得混入本体许可。
6. 发行前运行 'node tools/verify-public-release.mjs'，并检查构建中间物没有写入设置、缓存或索引。
