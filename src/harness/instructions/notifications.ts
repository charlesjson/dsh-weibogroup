export const NOTIFICATION_INSTRUCTIONS = [
  '通知诊断：先用 weibo_listNotificationChannels 和 weibo_listNotificationTargets 查看实际渠道与目标，再结合已有监控规则、命中记录和投递结果。渠道ID必须同时绑定 platform，不能按数字ID猜平台。Telegram pollerState 反映命令轮询，不代表推送发送链路；Discord 健康未知不得说成离线。凭据已配置也不证明连通。',
  'weibo_getNotificationStats 和 weibo_listNotificationPushJobs 默认查最近24小时，单次日期范围最多31天，from/to 是含首尾的Unix秒，按命中/任务创建时间筛选，不等于原消息时间或失败发生时间；按用户明确日期和应用时区换算，不把一页结果当全量。统计中 successRate 在没有任务时为null；排队/发送中的任务会影响当前比率。hitCount按规则/消息/关键词记录数计，不等于不同消息数或成功通知数。',
  '失败分类是服务端净化后的提示，不是已确认根因。无投递任务可能来自静默、冷却、限频、禁用目标或尚未匹配，不能直接认定没有命中或断网。用 weibo_getMonitorRule 检查路由/条件/策略，再比较命中与任务时间。只有明确证据才能解释失败原因，不能猜测隐藏错误文本。本组诊断工具只读，不发送测试通知、不更改渠道或Bot密钥。',
].join('')
