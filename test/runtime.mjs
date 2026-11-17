import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'

export async function installNativeTools(ctx) {
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeExecutor)
}

export async function executeNativeTool(ctx, { callId, name, arguments: args, signal, agent }) {
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
    signal,
    agent,
  })
  return batch.results[0].result
}
