/**
 * 本队会话与团队上下文（多团队 DESIGN §9.1/§9.2、M2）。
 *
 * - TeamContext 不可变，包含 clubId/memberId/epoch/membershipRevision。
 * - A→B→A 必须以 **epoch** 区分两次 A，只比较 clubId 不够。
 * - 切队只递增团队 epoch；账户失效才清账户层（由 AccountSession 负责）。
 */

export type ClubRole = 'member' | 'manager' | 'super_admin'

export type TeamState =
  | 'ACCOUNT_LOADING'
  | 'TEAM_SELECTION'
  | 'ENTERING'
  | 'READY'
  | 'SWITCHING'

export interface TeamContext {
  readonly backend: 'cloud'
  readonly env: string
  readonly appId: string
  readonly accountKey: string
  readonly accountEpoch: number
  readonly clubId: string
  readonly memberId: string
  readonly epoch: number
  readonly membershipRevision: number
}

export interface ActiveTeam {
  clubId: string
  clubName: string
  displayCode: string
  memberId: string
  displayName: string
  duty: string | null
  role: ClubRole
  membershipRevision: number
  permissions: string[]
}

export interface TeamBase {
  backend: 'cloud'
  env: string
  appId: string
  accountKey: string
  accountEpoch: number
}

export class TeamSessionStore {
  state: TeamState = 'ACCOUNT_LOADING'
  active: ActiveTeam | null = null
  switchError: string | null = null

  private teamEpoch = 0
  private switchAttemptId = ''
  private base: TeamBase | null = null

  /** 账户安装后绑定账户层，进入选队态。 */
  bindAccount(base: TeamBase): void {
    this.base = base
    this.active = null
    this.teamEpoch += 1
    this.switchAttemptId = ''
    this.switchError = null
    this.state = 'TEAM_SELECTION'
  }

  /** 清空并回到账户加载态（换微信/登出）。 */
  reset(): void {
    this.base = null
    this.active = null
    this.teamEpoch += 1
    this.switchAttemptId = ''
    this.switchError = null
    this.state = 'ACCOUNT_LOADING'
  }

  /** 进入某队：递增 epoch 并关闭受保护展示（返回 attemptId）。 */
  beginEnter(): string {
    if (!this.base) throw new Error('账户上下文未就绪')
    this.teamEpoch += 1
    this.switchAttemptId = `switch-${this.teamEpoch}`
    this.switchError = null
    this.state = 'ENTERING'
    return this.switchAttemptId
  }

  /** 进入成功后才安装完整会话（attemptId 不符则拒绝，旧尝试不能覆盖）。 */
  install(team: ActiveTeam, attemptId: string): boolean {
    if (attemptId !== this.switchAttemptId) return false
    this.active = team
    this.state = 'READY'
    return true
  }

  /** 进入失败：回选择页且不恢复旧缓存。 */
  failEnter(message: string): void {
    this.active = null
    this.switchError = message
    this.switchAttemptId = ''
    this.state = 'TEAM_SELECTION'
  }

  /** 该切换尝试是否仍是当前尝试（旧尝试的迟到结果不得改状态、不得清当前队）。 */
  isAttemptCurrent(attemptId: string): boolean {
    return attemptId !== '' && attemptId === this.switchAttemptId
  }

  /**
   * 本队资料变更（仅姓名/职务）：**就地**更新并同步 revision，不改变团队 epoch。
   * 角色/成员状态变更不在此处理（那会使当前权限上下文失效）。
   */
  applyProfile(
    ctx: TeamContext,
    patch: { displayName?: string; duty?: string | null; revision: number }
  ): boolean {
    const active = this.active
    if (!active || !this.isCurrent(ctx)) return false
    this.active = {
      ...active,
      displayName: patch.displayName ?? active.displayName,
      duty: patch.duty === undefined ? active.duty : patch.duty,
      membershipRevision: patch.revision,
    }
    return true
  }

  /** 捕获就绪的团队上下文（未 READY 即抛错）。 */
  captureReadyContext(): TeamContext {
    if (this.state !== 'READY' || !this.active || !this.base) {
      throw new Error('当前团队上下文未就绪')
    }
    return {
      backend: this.base.backend,
      env: this.base.env,
      appId: this.base.appId,
      accountKey: this.base.accountKey,
      accountEpoch: this.base.accountEpoch,
      clubId: this.active.clubId,
      memberId: this.active.memberId,
      epoch: this.teamEpoch,
      membershipRevision: this.active.membershipRevision,
    }
  }

  /** 请求返回时判定 ctx 是否仍为当前团队（含 A→B→A 的 epoch 区分）。 */
  isCurrent(ctx: TeamContext): boolean {
    if (!this.active || !this.base) return false
    return (
      ctx.accountEpoch === this.base.accountEpoch &&
      ctx.epoch === this.teamEpoch &&
      ctx.clubId === this.active.clubId &&
      ctx.memberId === this.active.memberId
    )
  }

  get epoch(): number {
    return this.teamEpoch
  }
}
