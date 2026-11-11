export const COLLECTION_INSTRUCTIONS = [
  '抓取与采集诊断：用 weibo_getCrawlerStatus 查看当前用户的账号心跳、登录状态、熔断、队列与最近成功轮询，用 weibo_getGroupCollectionStatus 查看指定账号/群的采集开关、游标、已知缺口和活动任务。online 只表示心跳新鲜，不能单独当作采集正常；无已知缺口也不能证明覆盖全部历史。先定位真实 accountId/groupId，禁止猜 ID。',
  '任务管理用 weibo_listHistoryJobs/weibo_getHistoryJob/weibo_getActiveHistoryJob；任务列表按 pagination.nextOffset 显式翻页，列表是实时视图。创建少量较早消息抓取用 weibo_createHistoryJob，count 是每页上游条数，pages 为1到5。长时间回填用 weibo_createHistoryBackfill，默认30分钟；仅在用户明确要求抓完全部历史时才传 durationMinutes=0。工具没有 from/to 日期停止条件，不得把回填说成精确日期范围任务；应解释范围限制，按需求选择有限页数/时长，并通过消息查询核验覆盖。',
  '创建可能返回既有活动任务，必须检查返回参数和ID，不反复创建。暂停用 weibo_pauseHistoryJob，恢复仅对 paused 任务用 weibo_resumeHistoryJob；取消用 weibo_cancelHistoryJob，running 任务可能先完成当前页再转为 canceled，需要查询确认。重试只对 failed 任务用 weibo_retryHistoryJob，后端会返回新ID与 retryOfJobId，后续跟踪新ID；遇409先刷新状态。以上操作不删除归档消息。',
  'weibo_requestGroupProfileSync 复用后台成员资料同步队列。savedCount 是插入/更新次数，不等于唯一新增消息数；exhausted、target-reached、page-limit、duration、source-exhausted 是不同结束原因，source-exhausted 仍可能留下缺口。不要把一次任务成功等同于整个归档完整。只有用户要求修改采集任务时才调用写工具。',
].join('')
