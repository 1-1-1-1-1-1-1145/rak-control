import Taro from '@tarojs/taro'
import { BACKEND } from '@/constants'
import { cloudEnter, cloudSnapshot, cloudTeamRuntime } from '@/store/cloud-team'
import { planDeepLink, resolveDeepLinkRoute } from './pending-intent'

/**
 * 深链唯一副作用入口（多团队 DESIGN §9.2、PLAN M7）。
 *
 * - 只在 cloud 模式生效；legacy/demo 不做多队切换。
 * - 异队：记 pendingIntent → 走**同一个**切队流程 → 会话安装成功后才消费并进入目标页；
 *   用户取消/失败**不消费**（intent 保留到下次进入该队）。
 * - 同队/已挂载页参数：直接进入，并对同一目标去重，避免重复 reLaunch。
 *
 * 说明：`switchAttemptId` 由协调器内部在 `beginEnter()` 生成，调用方无法预绑定；
 * 这里在**切换成功（新 epoch 会话已安装）后**以 `accountEpoch + clubId` 消费 intent，
 * 与"绑定尝试编号后一次消费"语义等价（一次消费、取消不消费、旧 epoch intent 不误消费）。
 */

let lastConsumedKey: string | null = null

export async function consumeDeepLink(query: Record<string, unknown> | null | undefined): Promise<void> {
  if (BACKEND !== 'cloud') return

  const rt = cloudTeamRuntime()
  const snapshot = cloudSnapshot()
  // 账户尚未识别 / 正在进入或切换：本次不处理，等下一次展示再判定
  if (!snapshot.accountIdentified) return
  if (snapshot.teamState === 'ENTERING' || snapshot.teamState === 'SWITCHING') return

  const plan = planDeepLink({
    query,
    accountEpoch: rt.account.epoch,
    activeClubId: snapshot.active?.clubId ?? null,
    teamState: snapshot.teamState,
  })

  if (plan.action === 'consumed') {
    const key = plan.route
    if (key === lastConsumedKey) return
    lastConsumedKey = key
    await Taro.reLaunch({ url: plan.route })
    return
  }

  if (plan.action !== 'switch') return

  rt.intents.set(plan.intent)
  const result = await cloudEnter(plan.clubId)
  if (!result.ok) return // 取消/失败：不消费 intent

  const target = rt.intents.consume(rt.account.epoch, plan.clubId)
  if (!target) return
  const route = resolveDeepLinkRoute(target)
  if (!route) return
  lastConsumedKey = route
  await Taro.reLaunch({ url: route })
}

/** 换账号/登出时重置本模块去重状态（避免复用旧路由判定）。 */
export function resetDeepLinkEntry(): void {
  lastConsumedKey = null
}
