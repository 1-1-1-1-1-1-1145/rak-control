# Rak 小程序开发与接入

## 本地演示

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build:weapp
```

完整的微信开发者工具导入、验收、故障排查及演示边界请看[微信开发者工具体验指南](./WECHAT-DEVTOOLS-GUIDE.md)。

本地演示可体验任务流转、团队成员、公告及 ROI；真实微信身份、邀请码/小程序码、入队审批和服务端权限由 CloudBase 云函数提供（见下节）。

## 云端开发（cloud-v2）

正式业务走 CloudBase 云函数（[ADR-0006](../adr/adr-0006-cloudbase-multiteam-backend.md)、[cloud-v2 契约](../api/cloud-v2.md)）。当前已完成身份、团队、成员、入会、任务、公告、ROI、绩效及分片上传的主要云端链路，并保留 fail-closed 默认：运行时配置缺失、未知动作或尚未完成的能力明确返回 `not_implemented`，不会回退到演示或 HTTP。

私有附件下载与草稿预览仍待上传/下载凭证 TTL 和真实对象恢复能力验证；双微信账号、双设备及真实文件字节验收仍为 NOT_RUN。本地单测与构建门禁不能替代这些云端和真机验收。

当前 SDK 数据库适配使用带扫描预算的服务端分页查询；索引清单已提供，但索引化查询与入口限流仍需在真实容量测试后补齐，不能据此宣称已通过规模化生产验证。

```powershell
pnpm test:server            # 云端契约/拒绝/幂等单测（server/tests）
pnpm build:cloud            # 编译并按目录生成 3 个自包含云函数包 → cloudfunctions/
pnpm verify:cloud:config    # infra 集合/规则/索引清单一致
pnpm verify:no-client-db    # 前端不得出现 DB SDK 调用
pnpm verify:cloud:artifacts # 函数产物结构/哈希/无秘密
pnpm verify:release         # 组合以上静态与发布包门禁
```

云函数目录：`rakApi`（业务）、`rakFiles`（文件）、`rakMaintenance`（后台，客户端禁 invoke）。`project.config.json` 的 `cloudfunctionRoot` 指向 `cloudfunctions/`（由 `build:cloud` 生成，已在 `.gitignore`）。

> 这些本地门禁与单测**不**代表真实云权限/事务/文件已验证；后者需要隔离环境与真实微信身份（`pnpm test:cloud:integration`，待 M8）。

## 旧 HTTP API（legacy）

以下 API 模式仅保留为历史/测试选项，不再是发布入口。正式云端不使用它。

## 连接开发 API

开发 API 模式必须显式关闭演示并设置 API 地址。仅本机开发允许 HTTP：

```powershell
$env:TARO_APP_DEMO = 'false'
$env:TARO_APP_API_BASE = 'http://localhost:8080'
pnpm build:weapp
```

构建完成后清除当前终端的变量，避免影响后续命令：

```powershell
Remove-Item Env:TARO_APP_DEMO, Env:TARO_APP_API_BASE
```

## 生产构建

生产构建拒绝本地演示和 HTTP 地址，必须提供与小程序接口契约一致的 HTTPS Rak API：

```powershell
$env:TARO_APP_API_BASE = 'https://rak-api.example.com'
pnpm build:weapp:prod
```

发布前将 `project.config.json` 中的 `touristappid` 替换成项目所有者的小程序 AppID，并在微信公众平台配置对应的 HTTPS 合法域名、隐私说明和服务类目。Rak 服务端还需安全配置相同的微信 AppID/AppSecret，准备隔离测试社团、成员和管理员。AppSecret 只放在服务端密钥管理中，不得写入小程序工程。

当前工程只有 Rak 客户端和后端契约提案，没有可运行的 Rak 服务端。因此生产构建的产物只有在兼容接口已部署、AppID 和微信合法域名已配置后才能完成真实登录及端到端联调。

## 需要你配置

本地演示只需要安装依赖、生成 `dist` 并在开发者工具中导入。若要进行真实微信/API 联调或发布体验版，再按以下顺序准备：

1. **小程序身份**：提供你拥有管理权的小程序 AppID；在本地将项目配置中的 `touristappid` 替换为它。AppID 可以作为配置提供，AppSecret 不可以。
2. **Rak 后端**：提供 Rak `rak-auth` 后端源码供实现，或已部署的隔离测试/预发 API 地址，以及后端实际的 `API.md`、测试社团、成员和管理员账号。只有 API URL 或 API key 不够：微信登录需要服务端用 AppID/AppSecret 校验微信登录码，并实现本项目的认证、任务、社团、公告、成员和 ROI API 契约。不要把 API key、AppSecret、登录码或 access token 发到聊天或写进小程序前端。
3. **微信平台域名**：在微信公众平台配置后端实际使用的 HTTPS `request` 合法域名；如果后端通过下载接口返回小程序码或上传附件，再配置相应的 `downloadFile`/`uploadFile` 合法域名。域名证书必须有效，不能用 localhost。生产环境还要准备隐私说明、服务类目和审核资料。
4. **服务端安全配置**：由后端运维把 AppID/AppSecret 放进服务端密钥管理，并播种初始 `super_admin`、manager 和隔离测试社团/成员/邀请码。AppSecret 只在服务端配置，不提供给小程序工程。
5. **契约对齐**：确认后端端点、字段、状态码和错误码与 Rak 客户端契约一致；若存在差异，先按后端实际文档调整服务层，再做登录、权限拒绝和完整任务/团队/ROI 联调。

拿到隔离测试 API 后，将构建命令里的 API base 改为该 HTTPS 地址，并在开发构建时明确设置 `TARO_APP_DEMO=false`。不要使用真实生产社团数据做开发验证。生产构建仍必须拒绝演示模式和 HTTP 地址。
