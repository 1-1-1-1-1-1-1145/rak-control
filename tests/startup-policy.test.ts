import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldBootstrap, shouldLoadTeamList } from '../src/utils/startup-policy.ts'

/**
 * 启动/恢复策略用例（2026-10-18 体验版三问题修复）。
 *
 * 覆盖三类进入场景：
 * - 冷启动（useLaunch）→ 必须引导；
 * - 后台驻留后重进（App.onShow）→ 仅在未就绪时补引导，已就绪不得重跑；
 * - 退出登录后（账户层已失效、状态 ACCOUNT_LOADING）→ 必须能再次引导。
 */

const CLOUD_READY = { isCloud: true, accountIdentified: true, teamState: 'TEAM_SELECTION' as const }

test('shouldBootstrap：冷启动/退出后必须引导', () => {
  // 首次冷启动：未识别、账户加载态
  assert.equal(
    shouldBootstrap({ isCloud: true, status: 'LOADING', accountIdentified: false, teamState: 'ACCOUNT_LOADING' }),
    true
  )
  // 退出登录后：clear() 把两层都清空 → 必须允许再次引导（否则永久 loading）
  assert.equal(
    shouldBootstrap({ isCloud: true, status: 'LOADING', accountIdentified: false, teamState: 'ACCOUNT_LOADING' }),
    true
  )
  // 状态不一致（已识别但仍 ACCOUNT_LOADING）→ 视为未完成，允许恢复
  assert.equal(
    shouldBootstrap({ isCloud: true, status: 'LOADING', accountIdentified: true, teamState: 'ACCOUNT_LOADING' }),
    true
  )
})

test('shouldBootstrap：已就绪不得重跑（否则重置团队状态、打断选队/切队）', () => {
  for (const teamState of ['TEAM_SELECTION', 'READY', 'ENTERING', 'SWITCHING'] as const) {
    assert.equal(
      shouldBootstrap({ isCloud: true, status: 'LOADING', accountIdentified: true, teamState }),
      false,
      `${teamState} 不应重跑引导`
    )
  }
  assert.equal(shouldBootstrap({ ...CLOUD_READY, status: 'AUTHED' }), false)
})

test('shouldBootstrap：ERROR 不自动重试（避免热启动无限循环），交给 UI 重试', () => {
  assert.equal(
    shouldBootstrap({ isCloud: true, status: 'ERROR', accountIdentified: false, teamState: 'ACCOUNT_LOADING' }),
    false
  )
  assert.equal(shouldBootstrap({ isCloud: false, status: 'ERROR', accountIdentified: false, teamState: 'ACCOUNT_LOADING' }), false)
})

test('shouldBootstrap：legacy 仅在 LOADING 引导', () => {
  const legacy = (status: 'LOADING' | 'AUTHED' | 'UNBOUND' | 'JOIN_PENDING') =>
    shouldBootstrap({ isCloud: false, status, accountIdentified: false, teamState: 'ACCOUNT_LOADING' })
  assert.equal(legacy('LOADING'), true)
  assert.equal(legacy('AUTHED'), false)
  assert.equal(legacy('UNBOUND'), false)
  assert.equal(legacy('JOIN_PENDING'), false)
})

test('shouldLoadTeamList：未识别不发请求；在途不重复；仅 cloud', () => {
  assert.equal(shouldLoadTeamList({ isCloud: true, accountIdentified: true, inFlight: false }), true)
  // 未识别 → 不发（否则 identity_required 会被误当成"加载失败"）
  assert.equal(shouldLoadTeamList({ isCloud: true, accountIdentified: false, inFlight: false }), false)
  // 单飞
  assert.equal(shouldLoadTeamList({ isCloud: true, accountIdentified: true, inFlight: true }), false)
  assert.equal(shouldLoadTeamList({ isCloud: false, accountIdentified: true, inFlight: false }), false)
})
