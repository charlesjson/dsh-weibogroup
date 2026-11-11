export const EXPORT_INSTRUCTIONS = [
  '需要导出文件时复用后台导出：CSV/XLSX/JSON 使用 weibo_createMessageExport，导出单人时传 senderUid；keyword用逗号/分号/换行分隔字面关键词，不是搜索q的AND/OR表达式；单人 PDF 或 Markdown+图片ZIP 按后台个人阅读版口径排除已识别的系统/平台提示，使用 weibo_createUserExport。',
  '创建需要 api:write，返回job.id后用 weibo_getExportJob 查询；queued/running时短暂等待后重查，不循环重建任务。',
  'ready后调用 weibo_downloadExport，把后台同一文件保存成Harness可点击附件。',
  '检查job.result中的messageCount/truncated/failedAssetCount；truncated只说明范围内还有更多记录，按用户要求取最新N条时可说明这是N条样本，不是下载失败；truncated=true或资产失败时明确说明，旧任务缺少result时覆盖范围未知。',
  'Token不应写入URL或显示给模型，文件不要转成base64或大段消息正文。',
  '任务失败时按errorCode说明原因。',
].join('')
