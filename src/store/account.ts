/**
 * 全局账户上下文（多团队 DESIGN §9.1、M2）。
 *
 * 账户与团队是两层生命周期：本文件只管**账户层**。
 * - 首次 bootstrap 未知 accountKey 时使用 bootstrapAttemptId。
 * - 成功且尝试仍有效才安装 AccountContext；换微信/登出/全局失效递增 accountEpoch。
 * - 普通切队**不**递增 accountEpoch（只递增团队 epoch，见 team-session）。
 */

export interface AccountContext {
  readonly backend: 'cloud'
  readonly env: string
  readonly appId: string
  readonly accountKey: string
  readonly accountEpoch: number
}

/** 首次 bootstrap 期间：accountKey 未知，用一次性 attemptId 保护安装。 */
export interface BootstrapCapture {
  readonly backend: 'cloud'
  readonly env: string
  readonly appId: string
  readonly accountKey: ''
  readonly accountEpoch: number
  readonly bootstrapAttemptId: string
}

export interface AccountInit {
  backend: 'cloud'
  env: string
  appId: string
}

export class AccountSession {
  private readonly init: AccountInit
  private accountKey = ''
  private accountEpoch: number
  private bootstrapAttemptId = ''
  private queryGeneration = 0

  constructor(init: AccountInit) {
    this.init = init
    this.accountEpoch = 1
  }

  get isIdentified(): boolean {
    return this.accountKey !== ''
  }

  get epoch(): number {
    return this.accountEpoch
  }

  /** 发起 GLOBAL 请求前捕获一次账户上下文（含当前 queryGeneration）。 */
  capture(): AccountContext | BootstrapCapture {
    if (!this.accountKey) {
      return {
        ...this.init,
        accountKey: '',
        accountEpoch: this.accountEpoch,
        bootstrapAttemptId: this.bootstrapAttemptId,
      }
    }
    return { ...this.init, accountKey: this.accountKey, accountEpoch: this.accountEpoch }
  }

  /** 开始一次首次 bootstrap 尝试，返回其 id 供安装时校验。 */
  beginBootstrapAttempt(attemptId: string): void {
    this.bootstrapAttemptId = attemptId
  }

  /** 安装账户身份；attemptId 与当前尝试不符则拒绝（迟到响应不回填）。 */
  install(accountKey: string, attemptId?: string): boolean {
    if (attemptId !== undefined && attemptId !== this.bootstrapAttemptId) return false
    if (!accountKey) return false
    this.accountKey = accountKey
    this.bootstrapAttemptId = ''
    this.accountEpoch += 1
    this.queryGeneration += 1
    return true
  }

  /** 请求返回时判定该 ctx 是否仍属于当前账户。 */
  isCurrent(ctx: { accountEpoch: number }): boolean {
    return ctx.accountEpoch === this.accountEpoch
  }

  /** GLOBAL 列表/查询的 generation 栅栏。 */
  nextQueryGeneration(): number {
    this.queryGeneration += 1
    return this.queryGeneration
  }

  currentQueryGeneration(): number {
    return this.queryGeneration
  }

  /** 换微信/登出/全局身份失效：清账户并递增 epoch。 */
  invalidate(): void {
    this.accountKey = ''
    this.bootstrapAttemptId = ''
    this.accountEpoch += 1
    this.queryGeneration += 1
  }
}
