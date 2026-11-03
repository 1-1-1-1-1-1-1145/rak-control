import Taro from '@tarojs/taro'
import type { CloudEnvelope, CloudFunctionName, CloudTransport } from './client'

/**
 * Taro 绑定层：真实 callFunction 传输（多团队 DESIGN §M2）。
 *
 * 只负责把信封交给云函数；错误映射与 scope 校验在 client.ts。
 * 必须在 cloud.init 完成后再使用。
 */
export function createTaroCloudTransport(): CloudTransport {
  return {
    callFunction(fn: CloudFunctionName, payload: CloudEnvelope): Promise<unknown> {
      const cloud = (Taro as unknown as { cloud?: { callFunction?: (args: unknown) => Promise<{ result?: unknown }> } }).cloud
      if (!cloud || typeof cloud.callFunction !== 'function') {
        throw new Error('当前运行环境不支持云函数调用')
      }
      return cloud
        .callFunction({ name: fn, data: payload })
        .then((res) => (res ? res.result : undefined))
    },
  }
}

/** 云初始化（cloud 模式必须先执行成功再 bootstrap）。 */
export function initCloud(env: string): Promise<void> {
  const cloud = (Taro as unknown as { cloud?: { init?: (args: unknown) => void } }).cloud
  if (!cloud || typeof cloud.init !== 'function') {
    return Promise.reject(new Error('当前运行环境不支持云初始化'))
  }
  cloud.init({ env, traceUser: true })
  return Promise.resolve()
}
