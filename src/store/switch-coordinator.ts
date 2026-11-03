import type { AccountContext, AccountSession, BootstrapCapture } from './account.ts'
import type { ActiveTeam, TeamSessionStore } from './team-session.ts'

/**
 * 切队协调器（多团队 DESIGN §9.2/§9.3、PLAN M7）。
 *
 * 顺序固定：脏编辑确认 → beginEnter（epoch++ 并关闭受保护展示）→ 清受保护状态
 * → 带 switchAttemptId 请求 enter → 核对账户/环境/尝试编号/scope → **一次安装**
 * 完整 TeamSession → reLaunch。任一步失败 → TEAM_SELECTION 且 activeTeam=null（不恢复旧缓存）。
 *
 * 本文件不依赖 Taro/MobX：enter 请求与 reLaunch 由调用方注入，便于单测。
 */

export interface EnterRequest {
  clubId: string
  switchAttemptId: string
  accountKey: string
  accountEpoch: number
  env: string
  appId: string
}

export interface EnterOutcome {
  clubId: string
  attemptId: string
  accountKey: string
  accountEpoch: number
  env: string
  appId: string
  team: ActiveTeam
}

export interface SwitchDeps {
  account: AccountSession
  session: TeamSessionStore
  enterTeam: (request: EnterRequest) => Promise<EnterOutcome>
  /** 清受保护展示/Store/页面局部/QR/URL/分页/弹窗/表单 */
  clearProtected: () => void
  reLaunch: (clubId: string) => void
  /** 是否存在未提交的本地编辑（脏表单/已选文件） */
  isDirty?: () => boolean
  toast?: (message: string) => void
}

export type SwitchResult =
  | { ok: true; clubId: string; attemptId: string }
  | { ok: false; reason: 'NEEDS_CONFIRM' | 'ENTER_FAILED'; message: string }

function accountContext(account: AccountSession): AccountContext {
  const ctx = account.capture() as AccountContext | BootstrapCapture
  if (!ctx.accountKey) throw new Error('账户上下文未就绪')
  return ctx as AccountContext
}

export class SwitchCoordinator {
  private readonly deps: SwitchDeps

  constructor(deps: SwitchDeps) {
    this.deps = deps
  }

  async switchTo(clubId: string, opts: { discardLocal?: boolean } = {}): Promise<SwitchResult> {
    if (this.deps.isDirty?.() && opts.discardLocal !== true) {
      return {
        ok: false,
        reason: 'NEEDS_CONFIRM',
        message: '有未提交的编辑：可留在当前团队，或放弃本次编辑并切换',
      }
    }

    let captured: AccountContext
    try {
      captured = accountContext(this.deps.account)
    } catch (error) {
      const message = error instanceof Error ? error.message : '账户上下文未就绪'
      return this.fail(message)
    }

    const attemptId = this.deps.session.beginEnter()
    this.deps.clearProtected()

    let outcome: EnterOutcome
    try {
      outcome = await this.deps.enterTeam({
        clubId,
        switchAttemptId: attemptId,
        accountKey: captured.accountKey,
        accountEpoch: captured.accountEpoch,
        env: captured.env,
        appId: captured.appId,
      })
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : '进入团队失败')
    }

    // 该尝试已被更新的切队取代：不改状态、不弹 toast（旧错误不得清空当前队）
    if (!this.deps.session.isAttemptCurrent(attemptId)) {
      return { ok: false, reason: 'ENTER_FAILED', message: '切换尝试已过期' }
    }

    if (!this.isVerified(outcome, captured, clubId, attemptId)) {
      return this.fail('进入团队失败：账户或环境已变化')
    }

    // 请求期间账户可能已失效/换号：以**当前**账户代次复核，迟到结果不得安装
    let current: AccountContext
    try {
      current = accountContext(this.deps.account)
    } catch {
      return this.fail('进入团队失败：账户已失效')
    }
    if (
      outcome.accountEpoch !== current.accountEpoch ||
      outcome.accountKey !== current.accountKey ||
      outcome.env !== current.env ||
      outcome.appId !== current.appId
    ) {
      return this.fail('进入团队失败：账户或环境已变化')
    }

    // 一次安装完整会话；attemptId 不符（期间又发生切队）则拒绝。
    // 此时状态已归属**更新的**尝试，故不改状态、不弹 toast（旧错误不得清空当前队）。
    if (!this.deps.session.install(outcome.team, attemptId)) {
      return { ok: false, reason: 'ENTER_FAILED', message: '切换尝试已过期' }
    }

    this.deps.reLaunch(clubId)
    return { ok: true, clubId, attemptId }
  }

  private isVerified(
    outcome: EnterOutcome,
    captured: AccountContext,
    clubId: string,
    attemptId: string
  ): boolean {
    return (
      outcome.clubId === clubId &&
      outcome.attemptId === attemptId &&
      outcome.accountEpoch === captured.accountEpoch &&
      outcome.accountKey === captured.accountKey &&
      outcome.env === captured.env &&
      outcome.appId === captured.appId
    )
  }

  private fail(message: string): SwitchResult {
    this.deps.session.failEnter(message)
    this.deps.toast?.(message)
    return { ok: false, reason: 'ENTER_FAILED', message }
  }
}
