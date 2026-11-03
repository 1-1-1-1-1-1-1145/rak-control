import { authStore } from './index'
import { shouldBootstrap } from '@/utils/startup-policy'

/**
 * 应用级引导（冷启动 + 热启动恢复）单飞控制。
 *
 * 为什么需要它：`App.useLaunch` 只在**进程冷启动**触发。以下场景都不会触发 useLaunch，
 * 但都必须能恢复：退出登录后（`clear()` 已把账户层失效并置 LOADING）、后台驻留后重进
 * （App.onShow）、reLaunch 到登录页。若无人再次引导，就会永久停在 loading。
 *
 * 单飞（in-flight）保证：`useLaunch` 与紧随其后的 `useDidShow`（以及登录页/选队页的兜底）
 * **只发起一次** bootstrap，不会并发安装两套会话。
 */

let inflight: Promise<void> | null = null

function currentPolicyInput() {
  return {
    isCloud: authStore.isCloud,
    status: authStore.status,
    accountIdentified: authStore.cloudAccountIdentified,
    teamState: authStore.cloudTeamState,
  }
}

export function isAppBootInFlight(): boolean {
  return inflight !== null
}

/**
 * 幂等引导：已就绪则立即返回；引导中则复用同一 Promise。
 *
 * 失败不抛出：错误态由 `authStore.bootstrap()` 内部写入 `status=ERROR` / `bootError`，
 * 由登录页的"重试"按钮再次调用本函数（此时会重新判定并允许尝试）。
 */
export function ensureAppBooted(): Promise<void> {
  if (!shouldBootstrap(currentPolicyInput())) return Promise.resolve()
  if (inflight) return inflight
  inflight = authStore
    .bootstrap()
    .catch(() => {
      /* 状态已由 bootstrap 内部写入 ERROR；此处仅防止未处理的 Promise 拒绝 */
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}
