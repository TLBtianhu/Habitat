# 插件生态与插件源

## 先签名索引，不急着自建服务器

第一阶段使用 GitHub 托管的签名插件索引，不必马上维护一台插件服务器：

- 每个插件包含 'id/version/apiRange/entry/capabilities/scopes/permissions/lifecycle/license'；
- 包含制品 URL、SHA256、签名、兼容范围和撤销列表；
- 主人安装/批准插件及其 scope，模型和普通观众不能安装插件；
- 下载到本地缓存，校验签名和哈希后再由 PluginRegistry 加载；
- 撤销后禁止新激活，已运行的实例按 owner 决定停用或保留只读。

## 本体与应用分开

核心 Habitat 与 QQ/B站/MC/HLS 等应用插件分开打包、分开版本、分开许可。应用插件不被本体 MIT 自动覆盖，插件作者保留自己的许可证。

后续需要私有索引、团队审核或访问控制时，再把同一索引协议迁移到自建服务器，客户端不必改变。
