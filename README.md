# 微博群聊问答 · DeepSeek Harness

在 Harness 中直接询问微博群聊归档，例如：

- “列出我归档的群。”
- “找出阿尼亚的 UID，总结她上个月关于 AI 的发言，附原文链接。”
- “统计阿尼亚发出的红包，按年月画条形图。发送条数和可见领取金额分别展示。”

提供 18 个原生工具（`weibo_` 前缀）：账号与群发现、成员与资料查询、
消息搜索/批量读取/上下文/窗口、时间线、发言与关键词统计、词云、市场报价。
自然语言理解和回答由 Harness 当前选择的模型完成，不需要再配置一套模型。
不注册发送、上传和撤回工具。已验证命令行 Harness **0.2.0-rc.2** 和桌面版 **0.2.2-rc.1** 的工具接口。

## 安装

```sh
npm ci --ignore-scripts
npm test
npm pack
dsh plugin --profile web add /srv/data/code/dshplugin/dsh-weibogroup/dsh-weibogroup-0.2.1.tgz
```

桌面版在插件页安装同一安装包：

```text
file:/srv/data/code/dshplugin/dsh-weibogroup/dsh-weibogroup-0.2.1.tgz
```

安装后重启对应 Harness 实例。禁用或卸载插件后，工具和问答指引自动撤回。

## 连接配置

在微博群聊管理后台的 AI API Tokens 页面创建独立的 **api:read** Token。
默认读取运行 Harness 的操作系统用户的
`~/.config/dsh-weibogroup/connection.json`：

```json
{
  "baseUrl": "https://weibogroup.chestnut.heiyu.space",
  "apiToken": "填入后台创建时显示的一次性 wg_ai_ Token"
}
```

```sh
chmod 700 ~/.config/dsh-weibogroup
chmod 600 ~/.config/dsh-weibogroup/connection.json
```

Token 每次调用时读取，轮换后无需重新打包。安装包不含网站密码、真实 Token
或群聊内容，Token 不作为工具参数提交给模型。远程连接要求 HTTPS，拒绝跳转，
避免把凭据转交给懒猫登录页面。连接配置仅在宿主进程内读取。

自定义 Cordis 配置支持 `connectionFile`、`timeoutMs`（默认 30000）、
`maxResponseBytes`（默认 4 MiB）和 `maxMessages`（默认 1000）。

懒猫应用的 `application.public_path` 需要放行 `/api/v1/` 和
`/api/docs/json`，业务接口仍要求 Bearer Token。客户端仍须连通微服虚拟网络。
对应 WeiboGroup 1.0.23 已包含这些路径设置。

## 统计口径

Harness 普通消息搜索只读取请求的一页，`limit=10` 最多返回10条；找群可以用 `listGroups(q=群名)`，找人可以用 `listGroupMembers(q=昵称,limit=20)`，无需下载整份名单。结果明确返回
`pagination.complete`、`pagination.truncated` 和 `nextCursor`。
需要更多原文时以相同条件显式使用返回的游标。优先用服务端 timeline 统计总量。语义、相关度、raw 查询保持逐页读取。
群的历史缺口、有限样本及未完成分页不能作为完整归档结论。

红包发送事件、领取回执、普通聊天提及红包分别判断。领取金额不是红包面额或
发送总额。没有可验证的金额字段时，回答应说明缺失。图表由 Harness 的展示/
文件工具基于已核对数据生成。插件不会把参考截图的数值当作真实查询结果。

## 验证与维护

源码按职责组织：

| 位置 | 职责 |
| --- | --- |
| `src/index.ts` | Cordis 插件入口与组合 |
| `src/config.ts` | 配置 schema、默认值与边界校验 |
| `src/api/client.ts` | 与 Harness 无关的归档客户端；统一鉴权、取消及返回预算 |
| `src/api/connection.ts`、`transport.ts` | 凭据文件、HTTPS、来源限制与重定向保护 |
| `src/api/catalog.ts` | 从 OpenAPI 发现只读操作 |
| `src/harness/` | 工具注册、生命周期、展示及通用问答指引 |
| `src/contracts/` | 随包分发的 API 契约 |
| `src/vendor/` | 从后端同步的 schema 校验、HTTP 执行及分页实现 |

扩展后端 API 时，在契约声明操作及读写语义，再执行同步和测试即可自动注册
只读工具，无需维护另一份接口名称白名单：

```sh
npm run sync-api -- /opt/code/weibogroup
npm test
npm pack
```

同步脚本直接从后端契约生成 OpenAPI，同时更新共享模块和
`vendor-provenance.json` 中的提交号、工作区状态及 SHA-256。
打包只使用已保存的快照，不要求安装机器存在后端源码。
需要增加宿主交互时修改 `src/harness/`；归档调用通过
`ArchiveClient.call(name, args, signal)`，无需接触 Cordis 或凭据。

`listUserMessageStats` 与 `getKeywordStats` 支持 `from/to`，可以直接查询
“最近七天谁发言最多”或指定窗口的字面关键词统计；日期省略时保持全历史口径。

```sh
npm run typecheck
npm test
npm run smoke
```

`smoke` 对已配置服务读取账号、群、消息和月度统计，仅输出数量及覆盖元数据。
工具参数与输出由随包携带的 OpenAPI 契约校验；服务升级更改契约后，执行
`sync-api` 更新 `src/contracts/openapi.json` 并重新打包。HTTP 校验及分页实现复用
WeiboGroup 的 MCP 适配层，来源见 THIRD_PARTY_NOTICES.md。
