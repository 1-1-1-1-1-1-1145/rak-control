import assert from 'node:assert/strict'
import test from 'node:test'

import { AccountSession } from '../src/store/account.ts'
import { TeamSessionStore, type ActiveTeam } from '../src/store/team-session.ts'
import { SwitchCoordinator, type EnterOutcome, type EnterRequest, type SwitchDeps } from '../src/store/switch-coordinator.ts'
import { decideGuard, decideLoginLanding } from '../src/utils/team-guard.ts'

const INIT = { backend: 'cloud' as const, env: 'cloud1-test', appId: 'wxa8bf102dcfdcec4c' }

function team(clubId: string): ActiveTeam {
  return {
    clubId,
    clubName: `队-${clubId}`,
    displayCode: clubId.toUpperCase(),
    memberId: `m-${clubId}`,
    displayName: '王同学',
    duty: null,
    role: 'member',
    membershipRevision: 1,
    permissions: [],
  }
}

function outcomeFor(req: EnterRequest): EnterOutcome {
  return {
    clubId: req.clubId,
    attemptId: req.switchAttemptId,
    accountKey: req.accountKey,
    accountEpoch: req.accountEpoch,
    env: req.env,
    appId: req.appId,
    team: team(req.clubId),
  }
}

function readySession(clubId = 'clubA'): { account: AccountSession; session: TeamSessionStore } {
  const account = new AccountSession(INIT)
  account.beginBootstrapAttempt('a1')
  account.install('key-1', 'a1')
  const session = new TeamSessionStore()
  session.bindAccount({ ...INIT, accountKey: 'key-1', accountEpoch: account.epoch })
  session.install(team(clubId), session.beginEnter())
  return { account, session }
}

test('守卫：账户页/选队页/需要本队/角色不足 各分支唯一落点', () => {
  // 账户页自行处理：未识别也 LOAD（否则新加入页会被旧 login 覆盖）
  assert.deepEqual(
    decideGuard({ state: 'ACCOUNT_LOADING', isAccountIdentified: false, hasActiveTeam: false, requiresTeam: false, isAccountPage: true }),
    { kind: 'LOAD' }
  )

  // 选队页：未识别 → login；加载中 → WAIT；已有团队**仍可停留**（主动切换/加入）；否则 LOAD
  const select = { state: 'TEAM_SELECTION' as const, hasActiveTeam: false, requiresTeam: false, isTeamSelectionPage: true }
  assert.deepEqual(decideGuard({ ...select, isAccountIdentified: false }), {
    kind: 'REDIRECT',
    to: 'login',
    reason: '账户尚未识别',
  })
  assert.deepEqual(decideGuard({ ...select, isAccountIdentified: true, state: 'ACCOUNT_LOADING' }), { kind: 'WAIT' })
  assert.deepEqual(decideGuard({ ...select, isAccountIdentified: true, hasActiveTeam: true }), { kind: 'LOAD' })
  assert.deepEqual(decideGuard({ ...select, isAccountIdentified: true }), { kind: 'LOAD' })

  // 普通页：未识别 → login
  assert.deepEqual(
    decideGuard({ state: 'TEAM_SELECTION', isAccountIdentified: false, hasActiveTeam: false, requiresTeam: true }).to,
    'login'
  )
  // bootstrap/enter 未完成 → WAIT（不展示缓存权限）
  assert.deepEqual(
    decideGuard({ state: 'ENTERING', isAccountIdentified: true, hasActiveTeam: false, requiresTeam: true }),
    { kind: 'WAIT' }
  )
  // 需要本队但无 activeTeam → select
  assert.deepEqual(decideGuard({ state: 'TEAM_SELECTION', isAccountIdentified: true, hasActiveTeam: false, requiresTeam: true }), {
    kind: 'REDIRECT',
    to: 'select',
    reason: '需要选择团队',
  })
  // 角色不足 → me
  assert.deepEqual(
    decideGuard({ state: 'READY', isAccountIdentified: true, hasActiveTeam: true, requiresTeam: true, requiresRole: 'manage', role: 'member' }),
    { kind: 'REDIRECT', to: 'me', reason: '权限不足' }
  )
  // 全部满足 → LOAD
  assert.deepEqual(
    decideGuard({ state: 'READY', isAccountIdentified: true, hasActiveTeam: true, requiresTeam: true, requiresRole: 'manage', role: 'manager' }),
    { kind: 'LOAD' }
  )

  // 登录页落点（cloud）：已识别但未进入任何本队（含 0 队）必须离开登录页，否则 cloud 模式下永久 loading
  assert.equal(
    decideLoginLanding({ isCloud: false, accountIdentified: true, hasActiveTeam: false, state: 'TEAM_SELECTION' }),
    'STAY'
  )
  assert.equal(
    decideLoginLanding({ isCloud: true, accountIdentified: false, hasActiveTeam: false, state: 'ACCOUNT_LOADING' }),
    'STAY'
  )
  assert.equal(
    decideLoginLanding({ isCloud: true, accountIdentified: true, hasActiveTeam: false, state: 'ENTERING' }),
    'STAY'
  )
  assert.equal(
    decideLoginLanding({ isCloud: true, accountIdentified: true, hasActiveTeam: false, state: 'SWITCHING' }),
    'STAY'
  )
  assert.equal(
    decideLoginLanding({ isCloud: true, accountIdentified: true, hasActiveTeam: true, state: 'READY' }),
    'STAY'
  )
  assert.equal(
    decideLoginLanding({ isCloud: true, accountIdentified: true, hasActiveTeam: false, state: 'TEAM_SELECTION' }),
    'TEAM_SELECT'
  )
})

test('协调器：成功路径按 清受保护→enter→安装→reLaunch 顺序，且一次安装完整会话', async () => {
  const { account, session } = readySession('clubA')
  const calls: string[] = []
  const coordinator = new SwitchCoordinator({
    account,
    session,
    clearProtected: () => calls.push('clear'),
    enterTeam: async (req) => {
      calls.push(`enter:${req.clubId}`)
      return outcomeFor(req)
    },
    reLaunch: (clubId) => calls.push(`relaunch:${clubId}`),
  })

  const result = await coordinator.switchTo('clubB')
  assert.equal(result.ok, true)
  assert.equal(session.state, 'READY')
  assert.equal(session.active?.clubId, 'clubB')
  assert.deepEqual(calls, ['clear', 'enter:clubB', 'relaunch:clubB'])

  // A→B→A：回到 A 也是新代次，旧 A 的 ctx 不再 current
  const ctxB = session.captureReadyContext()
  await coordinator.switchTo('clubA')
  const ctxA2 = session.captureReadyContext()
  assert.notEqual(ctxA2.epoch, ctxB.epoch)
  assert.equal(session.isCurrent(ctxB), false)
  assert.equal(session.isCurrent(ctxA2), true)
})

test('协调器：enter 失败 → TEAM_SELECTION 且 activeTeam=null（不恢复旧缓存）', async () => {
  const { account, session } = readySession('clubA')
  const toasts: string[] = []
  const coordinator = new SwitchCoordinator({
    account,
    session,
    clearProtected: () => {},
    enterTeam: async () => {
      throw new Error('team_maintenance')
    },
    reLaunch: () => {},
    toast: (message) => toasts.push(message),
  })

  const result = await coordinator.switchTo('clubB')
  assert.equal(result.ok, false)
  assert.equal((result as { reason: string }).reason, 'ENTER_FAILED')
  assert.equal(session.state, 'TEAM_SELECTION')
  assert.equal(session.active, null)
  assert.equal(toasts.length, 1)

  // 返回 A 也要重新 enter（不因失败恢复旧缓存）
  assert.equal(session.active, null)
})

test('协调器：脏编辑未确认 → NEEDS_CONFIRM 且不发起 enter、不改状态', async () => {
  const { account, session } = readySession('clubA')
  let entered = 0
  const coordinator = new SwitchCoordinator({
    account,
    session,
    clearProtected: () => {},
    isDirty: () => true,
    enterTeam: async (req) => {
      entered += 1
      return outcomeFor(req)
    },
    reLaunch: () => {},
  })

  const held = await coordinator.switchTo('clubB')
  assert.equal(held.ok, false)
  assert.equal((held as { reason: string }).reason, 'NEEDS_CONFIRM')
  assert.equal(entered, 0)
  assert.equal(session.state, 'READY')
  assert.equal(session.active?.clubId, 'clubA')

  const discarded = await coordinator.switchTo('clubB', { discardLocal: true })
  assert.equal(discarded.ok, true)
  assert.equal(session.active?.clubId, 'clubB')
})

test('协调器：请求期间账户失效 → 迟到结果不得安装', async () => {
  const { account, session } = readySession('clubA')
  let enterResolve: (outcome: EnterOutcome) => void = () => {}
  const coordinator = new SwitchCoordinator({
    account,
    session,
    clearProtected: () => {},
    enterTeam: () =>
      new Promise<EnterOutcome>((resolve) => {
        enterResolve = resolve
      }),
    reLaunch: () => {},
  })

  const pending = coordinator.switchTo('clubB')
  account.invalidate()
  enterResolve({ ...outcomeFor({ clubId: 'clubB', switchAttemptId: 'switch-x', accountKey: 'key-1', accountEpoch: 2, env: INIT.env, appId: INIT.appId }) })

  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(session.active, null)
  assert.equal(session.state, 'TEAM_SELECTION')
})

test('协调器：期间又发起新切队 → 旧尝试的迟到 enter 不改状态、不清新队', async () => {
  const { account, session } = readySession('clubA')
  let resolveB: (outcome: EnterOutcome) => void = () => {}
  const coordinator = new SwitchCoordinator({
    account,
    session,
    clearProtected: () => {},
    enterTeam: (req) =>
      req.clubId === 'clubB'
        ? new Promise<EnterOutcome>((resolve) => {
            resolveB = resolve
          })
        : Promise.resolve(outcomeFor(req)),
    reLaunch: () => {},
  })

  const staleB = coordinator.switchTo('clubB')
  const newest = await coordinator.switchTo('clubC')
  assert.equal(newest.ok, true)
  assert.equal(session.active?.clubId, 'clubC')

  // 迟到的 B：attemptId 已过期（状态已归属 C）
  resolveB({
    clubId: 'clubB',
    attemptId: 'switch-stale',
    accountKey: 'key-1',
    accountEpoch: account.epoch,
    env: INIT.env,
    appId: INIT.appId,
    team: team('clubB'),
  })
  const staleResult = await staleB
  assert.equal(staleResult.ok, false)

  assert.equal(session.state, 'READY')
  assert.equal(session.active?.clubId, 'clubC')
  assert.notEqual(session.captureReadyContext().epoch, 0)
})

test('本队资料就地更新：改姓名/职务不动团队 epoch 与角色', () => {
  const { session } = readySession('clubA')
  const before = session.captureReadyContext()

  assert.equal(session.applyProfile(before, { displayName: '新名字', duty: '部长', revision: 2 }), true)
  const after = session.captureReadyContext()
  assert.equal(after.epoch, before.epoch)
  assert.equal(after.memberId, before.memberId)
  assert.equal(after.membershipRevision, 2)
  assert.equal(session.active?.displayName, '新名字')
  assert.equal(session.active?.duty, '部长')
  assert.equal(session.active?.role, 'member')

  // 未提供 duty 时保持原值（不把"未修改"写成 null）
  assert.equal(session.applyProfile(before, { displayName: '又改名', revision: 3 }), true)
  assert.equal(session.active?.displayName, '又改名')
  assert.equal(session.active?.duty, '部长')
  assert.equal(session.active?.membershipRevision, 3)

  assert.equal(
    session.applyProfile({ ...before, clubId: 'clubB' }, { displayName: '另一队旧响应', revision: 4 }),
    false
  )
  assert.equal(session.active?.displayName, '又改名')
})

test('协调器：账户未识别时拒绝切队（不伪造进入）', async () => {
  const account = new AccountSession(INIT)
  const session = new TeamSessionStore()
  let entered = 0
  const deps: SwitchDeps = {
    account,
    session,
    clearProtected: () => {},
    enterTeam: async (req) => {
      entered += 1
      return outcomeFor(req)
    },
    reLaunch: () => {},
  }
  const coordinator = new SwitchCoordinator(deps)

  const result = await coordinator.switchTo('clubA')
  assert.equal(result.ok, false)
  assert.equal(entered, 0)
  assert.equal(session.active, null)
})
