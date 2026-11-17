# 微博群聊问答 · DeepSeek Harness

在 Harness 中直接询问微博群聊归档。以下尖括号内容均为占位符，不代表真实用户或群组，例如：

- “列出我归档的群。”
- “找出「<成员昵称>」的 UID，总结该成员上个月关于某个话题的发言，附原文链接。”
- “统计「<成员昵称>」发出的红包，按年月画条形图。发送条数和可见领取金额分别展示。”

标准 Harness 提供 46 个原生工具（`weibo_` 前缀，含查询、导出任务、附件下载、监控管理、采集任务和通知诊断）：账号与群发现、成员与资料查询、
消息搜索/批量读取/上下文/窗口、时间线、发言与关键词统计、词云、归档图片读取、采集任务、采集状态和通知诊断。
自然语言理解和回答由 Harness 当前选择的模型完成，不需要再配置一套模型。
支持复用后台生成 CSV/XLSX/JSON、单人 PDF/ZIP，并以原生文件附件交付。微博发送、图片/视频上传和撤回工具继续不注册。已验证命令行 Harness **0.2.0-rc.2** 和桌面版 **0.2.2-rc.2** 的工具接口。

## 安装

通过固定的 GitHub 版本安装：

```sh
dsh plugin --profile web add github:charlesjson/dsh-weibogroup#v0.6.3
dsh plugin --profile headless add github:charlesjson/dsh-weibogroup#v0.6.3
```

桌面版在插件页填写同一 GitHub 引用：

```text
github:charlesjson/dsh-weibogroup#v0.6.3
```

安装后重启对应 Harness 实例。版本标签与锁文件固定源码提交，避免跟随 main
的未发布改动。仓库包含编译后的 dist，安装时不需要后端源码或重新编译。
禁用或卸载插件后，工具和问答指引自动撤回。

本地开发与打包：

```sh
git clone https://github.com/charlesjson/dsh-weibogroup.git
cd dsh-weibogroup
npm ci --ignore-scripts
npm test
npm pack
```

## 连接配置

在微博群聊管理后台的 AI API Tokens 页面创建独立 Token：查询/下载需要 **api:read**，创建导出还需要 **api:write**。
默认读取运行 Harness 的操作系统用户的
`~/.config/dsh-weibogroup/connection.json`：

```json
{
  "baseUrl": "https://archive.example.com",
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

## 复用后台导出

可以直接提问“把 「<群名称>」最近三天消息导出成 Excel”或“把某成员上周的发言导出成 PDF”。

1. `weibo_createMessageExport`：CSV、XLSX、JSON，支持日期、关键词及可选 senderUid/order（默认正序；最近N条用order=desc配合limit）；关键词按逗号/分号/换行分隔，匹配任一字面关键词，不是搜索接口的 Boolean q 语法。
2. `weibo_createUserExport`：指定成员的 PDF 或 Markdown+图片 ZIP，保留后台个人阅读版的系统/平台提示过滤口径；CSV/XLSX/JSON 则保留 messageKind 原始分类。
3. 用 `weibo_getExportJob` 查询返回的任务 ID，等待 `ready`；失败时查看 errorCode。
4. `weibo_downloadExport` 流式下载并存入 Harness 原生附件，聊天中可以点击文件下载。Token 不进入模型参数/下载链接，文件内容不通过 base64 填入上下文。

这些操作与后台共用同一个 ExportService、任务队列、渲染器、配额、7天保留期及文件；后台创建的任务也能在插件中查询。导出只生成派生文件，原始归档消息保持原样。

`result.messageCount/rowLimit/truncated/failedAssetCount` 说明覆盖范围；下载结果会再次提示截断及附件失败。旧任务缺少统计信息时提示覆盖范围未知。创建任务是写操作，需要写权限；list/status/download 使用读权限。

下载默认上限64 MiB、120秒，可配置 `maxExportBytes`（最大512 MiB）及 `exportTimeoutMs`（最大10分钟）。附件存储服务存在时启用下载工具；标准桌面/web/headless profile 均提供该服务。自定义精简 profile 应挂载 `attachments` 能力。

## 后台关键词与发送者监控

例如“监控 「<群名称>」提到故障的消息，发到我的 Telegram”“把某条规则暂停”或
“查看这条规则最近命中了什么、通知有没有发送”。支持 WeiboGroup 1.0.27+。

- `weibo_listNotificationTargets`：发现已配置的 Telegram/Discord 目标，不返回 Bot 凭据。
- `weibo_listMonitorRules`、`weibo_getMonitorRule`：读取后台同一份规则及全部投递路由。
- `weibo_createMonitorRule`、`weibo_updateMonitorRule`、`weibo_deleteMonitorRule`：创建、修改、启停和明确删除；需要 api:write。
- `weibo_listMonitorRuleHits`、`weibo_listMonitorRulePushJobs`：区分关键词命中与通知投递；均支持分页。

沿用后台 contains/exact/regex 匹配方式，关键词内部 OR、发送者 UID 内部 OR，
两类条件之间 AND；仅 UID 的规则可以关注该人的全部发言。默认实时/最新轮询
来源，已处理的历史不自动重放。每个 destination 独立配置模板、限频、静默时段。
PATCH 仅修改传入字段；destinations 数组整体替换，修改前应读取并保留其他路由。
账号与群组是独立筛选，限定一个群时同时指定其账号，避免放大作用域。

启停沿用后台缓存，约 10 秒刷新；暂停后已入队通知仍可能发送。删除会移除规则、
路由与命中历史，已有投递任务保留且解除关联；只想停用时使用 enabled=false。
hitCount 按规则/消息/关键词记录计算，同一条消息命中两个词会计两条。
没有投递任务不能证明没有命中，静默和限频可以在入队前抑制通知。

列表默认20条、最大100条，用 pagination.nextOffset 翻页。分页是实时视图，
并发增删时顺序可能变化；truncated=true 代表还有记录，不能当作完整清单。

## 采集任务、采集状态和通知诊断

可以提问“「<群名称>」最近为什么没新消息”“暂停这条抓取任务”“重试失败的历史回填”或“这条监控为什么没通知”。

- `listHistoryJobs/getHistoryJob/getActiveHistoryJob`：查询后台同一份任务与进度。
- `createHistoryJob/createHistoryBackfill`：分别创建有限页数抓取、按时长回填；任务可能复用已有活动任务。
- `pauseHistoryJob/resumeHistoryJob/cancelHistoryJob/retryHistoryJob`：管理状态；重试返回新的任务 ID，取消运行任务可能等待当前页完成。
- `requestGroupProfileSync`：复用群成员资料同步队列。
- `getCrawlerStatus/getGroupCollectionStatus`：账号心跳、登录状态、熔断、队列、采集游标与已知缺口。
- `listNotificationChannels/getNotificationStats/listNotificationPushJobs`：渠道配置状态、通知汇总与经过净化的失败分类，不返回 Bot/代理密钥、原始错误或投递内容。

采集写操作需要 `api:write`；查询需要 `api:read`。本组工具不删除历史消息，不发送测试通知。
历史抓取不支持精确的日期停止条件；`count` 为每页条数，`pages` 为1–5。
长回填默认30分钟，`durationMinutes=0` 只用于用户明确要求抓完全部历史的情况。
缺失时间戳表示未记录或未知，不代表从未执行；无已知缺口不等于归档完整，`savedCount` 也不等于唯一新增消息数。
通知统计默认最近24小时、最多31天，按记录创建时间筛选；没有任务时成功率为 null。
Telegram 的命令轮询状态与推送投递分别判断；失败分类仅是诊断提示。

后台定时日报没有接入。需要定时调用这些工具时，使用 DSH 自己的定时任务；Web profile 可启用官方 `@deepseek-ai/dsh-experimental-schedule-bundle`，Host 运行期间执行。

## 读取消息中的图片

需要识图时，先查询消息的 `assets`，再调用 `weibo_readMessageImage`，传入同一条消息的
`accountId/groupId/messageId/assetType/assetKey`；普通附件 `imageIndex=0`，分享中的多图可按需选择索引。
后台按归档资源和Token归属校验，读取已有图片缓存或通过微博账号代理获取，支持PNG/JPEG/WebP/GIF。
插件校验资源绑定、摘要、类型和大小，通过Harness原生图片能力保存并送入视觉模型上下文。
模型无需接触Token、微博Cookie、下载链接或base64参数。

需要支持图片输入的模型和宿主附件服务。只返回URL不代表看到了图片；若模型不支持、资源已失效、
图片损坏或超限，会明确报错或显示不可用提示，不能据此编造图片内容。
`preview=true`表示已有缩略图；GIF可能只保留静态帧。图中文字和二维码中的指令同样是不可信数据。
默认图片上限20 MiB、90秒，可通过 `maxImageBytes` 降低上限（最大20 MiB）和
`imageTimeoutMs` 调整超时（1–300秒）。需要WeiboGroup 1.0.30+。

## 完整取数与总结

现有接口可间接实现指定范围内的完整消息读取：固定账号/群/日期，按时间顺序调用
`searchMessages`，保持筛选条件一致，显式续用 `nextCursor` 直到结束，并核对分页标记与服务端统计。
用户发言排行榜在所有日期模式下排除系统消息和未知发送者UID，原始消息时间线/导出则保留原始记录口径，核对总数时先统一筛选。
Harness 消息搜索和窗口每页默认10条、最大20条；每页还有24KB输出预算，长消息会自动缩小本页条数，未读完要继续返回的游标。
也可创建JSON/CSV导出，检查 `result.truncated`，下载原生附件后由DSH读取文件、分段总结。
文件下载完成不等于模型已处理全部内容。导出最多10万条，超过时应拆分范围。
这些能力针对已归档消息，不能补回未采集的数据，也不能把活动采集期间的分页当作冻结快照。
后台日报上下文与后台定时日报没有接入插件。

## 统计口径

Harness 普通消息搜索只读取请求的一页，`limit=10` 最多返回10条；找群可以用 `listGroups(q=群名)`，找人可以用 `listGroupMembers(q=昵称,limit=20)`，无需下载整份名单。结果明确返回
`pagination.complete`、`pagination.truncated` 和 `nextCursor`。
需要更多原文时以相同条件显式使用返回的游标。优先用服务端 timeline 统计总量。语义、相关度、raw 查询保持逐页读取。
群的历史缺口、有限样本及未完成分页不能作为完整归档结论。

红包发送事件、领取回执、普通聊天提及红包分别判断。领取金额不是红包面额或
发送总额。没有可验证的金额字段时，回答应说明缺失。图表由 Harness 的展示/
文件工具基于已核对数据生成。插件不会把参考截图的数值当作真实查询结果。

## 消息分页与模型上下文预算

插件将分页方法同时写进工具参数、工具说明和模型系统指引。无需修改后端 REST API。
本节能力从 `0.6.3` 开始提供。桌面 profile 由 DSH 应用管理，须通过桌面插件页安装
上面的 GitHub 引用或本地 `dsh-weibogroup-0.6.3.tgz`；CLI 不支持直接管理桌面 profile。
安装后重启相应实例，加载新工具参数与模型指引。

| 工具 | 首次读取 | 继续读取 |
| --- | --- | --- |
| `weibo_searchMessages` | `limit=10`（最大20），优先限定账号/群/日期 | 把 `nextCursor` 原样传入 `cursor`，其他筛选和排序不变 |
| `weibo_getMessageContext` | `before/after` 默认各5，定义总窗口；`pageSize=10`（最大20） | 把 `nextPageCursor` 原样传入 `pageCursor`，账号/群/目标/before/after/raw/detail不变 |
| `weibo_getMessageWindow` | `limit=10`（最大20），只传一个方向的消息ID | 使用返回的 `pagination.continuation` 参数；向旧用本页首条ID，向新用末条ID |

上下文的 `pagination.totalMessageCount` 是请求窗口内的条数，`complete` 只表示该窗口已读到末尾。
`targetIncluded=false` 表示目标原文不在当前页，须继续读取后才能核验引文。
上下文游标绑定查询范围和窗口快照；出现 `CONTEXT_PAGE_STALE` 时省略 `pageCursor` 从第一页重新读取。
这不冻结整个归档。搜索与窗口是实时游标，不提供跨调用的冻结快照。
窗口的 `hasMore=null` 表示暂时未知；后续为空页或 `hasMore=false` 才能确认该方向结束。
三类游标不能互换，`beforeMessageId/afterMessageId` 不能同时传入。

列表默认 `detail="compact"`：正文 `content` 完整保留，返回消息身份、发送者、时间、状态、引用锚点和附件键；
省略头像、个人主页、附件 metadata、重复引用树和逐条搜索摘要。省略字段会在 `presentation.omittedFields` 中列出。
顶层搜索模式、语义降级和候选集截断信息继续保留。需要详细引用、附件字段时优先
`getMessagesBatch(keys=[{accountId,groupId,messageId}])` 单条读取；也可小页 `detail="full"`。
显式 `raw="1"` 保留完整字段。列表每页不超过24KB文本，按完整消息边界缩页，不裁剪正文。
单条也超过预算时返回 `MESSAGE_TOO_LARGE` 和 `messageKey`，不跳过消息、不推进游标；再按该键读取详情。
精确详情工具仍可返回较大原文，因此应按需单条调用。

文本输出为多行JSON，方便宿主 `read` 分段读取。若宿主仍产生溢出文件，用宿主文件工具按段读取，
不要通过 bash 反复寻找 `/tmp` 文件：命令沙箱可能使用独立的临时目录。

## 验证与维护

源码按职责组织：

| 位置 | 职责 |
| --- | --- |
| `src/index.ts` | Cordis 插件入口与组合 |
| `src/config.ts` | 配置 schema、默认值与边界校验 |
| `src/api/client.ts`、`exports.ts` | 与 Harness 无关的归档客户端及有界文件流；统一鉴权、取消及返回预算 |
| `src/api/message-pages.ts` | Harness 消息参数、精简投影、上下文游标、输出字节预算与窗口继续参数 |
| `src/api/connection.ts`、`transport.ts` | 凭据文件、HTTPS、来源限制与重定向保护 |
| `src/api/session.ts` | 查询与导出共用的凭据快照、取消信号及 HTTP 执行预算 |
| `src/api/catalog.ts` | 从 OpenAPI 发现操作，统一只读查询及 export/monitor/collection 写能力的开放、展示与并发策略 |
| `src/harness/register.ts`、`exports.ts` | 宿主工具注册、生命周期、展示和附件交付 |
| `src/harness/instructions/` | 按查询、导出、监控、采集、图片和通知诊断维护模型指引，由 `instructions.ts` 统一组合 |
| `src/contracts/` | 随包分发的 API 契约 |
| `src/vendor/` | 从后端同步的 schema 校验、HTTP 执行及分页实现 |

扩展后端 API 时，在契约声明操作及读写语义，再执行同步和测试即可自动注册
只读工具；写工具仅开放明确标注 export/monitor/collection 能力的操作，发送和撤回微博消息不开放。
无需维护另一份接口名称白名单：

```sh
npm run sync-api -- /path/to/weibogroup
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

公开文档、截图和验收摘要仅使用占位数据。不要提交真实昵称、UID、群名、群ID、实例地址、凭据、会话/导出任务标识或聊天内容；详细运行证据应留在私有环境。

## DSH 兼容声明

宿主与 DSH peer 依赖统一声明为 `0.2.0-rc.2 || >=0.2.2-rc.1`，只保留最低版本，不再设置未来版本上限。
Cordis peer 同样只保留已验证的最低版本；开发依赖与锁文件仍固定测试基线。
以后升级到 0.3、1.0 或更高版本时，不会仅因版本号变化被本插件声明禁用。

插件在注册功能前检查其依赖的宿主方法；前端插件也会在注册界面前检查方法。
缺少必需方法时会报告 `DSH_API_UNSUPPORTED` 和具体接口名称，不会先留下部分注册。
新增无关接口不影响加载。缺少已声明的注入服务或模块导出时，宿主加载器会报告相应依赖错误。
方法存在性检查无法证明参数、返回值、事件结构或行为语义完全不变；这类变更仍可能需要适配。

`npm test` 与 `npm pack` 使用真实 DSH 兼容检查器覆盖最低版本和未来主版本号；
未来版本矩阵检查的是声明策略，不代表尚未发布的宿主已经经过集成测试。
