import assert from 'node:assert/strict'
import test from 'node:test'

import { MemoryDatabase } from '../repositories/store.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import { identityId } from '../repositories/ids.ts'
import { REFERENCE_TTL_MS, bootstrap, provisioningReference, type AuthDeps } from '../modules/auth/index.ts'
import { initializePlatform } from '../modules/provisioning/index.ts'
import { APP_ID, ENV, makeClock } from './helpers.ts'

const identity = { appId: APP_ID, openid: 'o1', env: ENV }

test('bootstrap 幂等：同 openid 只留一份 identity/user，未初始化时 setupRequired', async () => {
  const db = new MemoryDatabase()
  const clock = makeClock()
  const deps: AuthDeps = { db, now: clock.now }

  const first = await bootstrap(deps, identity)
  const second = await bootstrap(deps, identity)

  assert.equal(first.accountKey, second.accountKey)
  assert.equal(first.setupRequired, true)
  assert.equal(first.securityState, 'NORMAL')
  assert.equal((await db.query(COLLECTIONS.identities, () => true)).length, 1)
  assert.equal((await db.query(COLLECTIONS.users, () => true)).length, 1)
})

test('参考号：签发 → 有效期内复用 → 过期重发；未消费不能换发', async () => {
  const db = new MemoryDatabase()
  const clock = makeClock()
  const deps: AuthDeps = { db, now: clock.now }
  await bootstrap(deps, identity)

  const issued = await provisioningReference(deps, identity)
  assert.equal(issued.state, 'ISSUED')
  if (issued.state !== 'ISSUED') return

  const reused = await provisioningReference(deps, identity)
  assert.equal(reused.state, 'REUSED')
  assert.equal(reused.expiresAt, issued.expiresAt)

  // 未消费时 replaceConsumed 仍不换发
  assert.equal((await provisioningReference(deps, identity, true)).state, 'REUSED')

  clock.advance(REFERENCE_TTL_MS + 1)
  const reissued = await provisioningReference(deps, identity)
  assert.equal(reissued.state, 'ISSUED')
  if (reissued.state !== 'ISSUED') return
  assert.notEqual(reissued.code, issued.code)
})

test('已消费参考号：默认不返回可用号，replaceConsumed 才换发', async () => {
  const db = new MemoryDatabase()
  const clock = makeClock()
  const deps: AuthDeps = { db, now: clock.now }
  await bootstrap(deps, identity)
  const issued = await provisioningReference(deps, identity)
  assert.equal(issued.state, 'ISSUED')
  if (issued.state !== 'ISSUED') return

  const id = identityId(APP_ID, 'o1')
  await db.tx(async (tx) => {
    const doc = await tx.get(COLLECTIONS.identities, id)
    if (!doc) throw new Error('夹具：identity 缺失')
    await tx.set(COLLECTIONS.identities, { ...doc, ownerReferenceUsedAt: clock.now() })
  })

  assert.equal((await provisioningReference(deps, identity)).state, 'CONSUMED')
  const replaced = await provisioningReference(deps, identity, true)
  assert.equal(replaced.state, 'REPLACED')
  if (replaced.state !== 'REPLACED') return
  assert.notEqual(replaced.code, issued.code)
})

test('平台初始化后仍可签发参考号（开新队所需），且已消费时默认不返回可用号', async () => {
  const db = new MemoryDatabase()
  const clock = makeClock()
  const deps: AuthDeps = { db, now: clock.now }
  await bootstrap(deps, identity)
  await initializePlatform({ db, now: clock.now, newClubId: () => 'club-test-1' }, APP_ID)

  const config = await db.read(COLLECTIONS.systemConfig, 'main')
  assert.ok(config, '夹具：平台应已初始化')

  const issued = await provisioningReference(deps, identity)
  assert.equal(issued.state, 'ISSUED')
  if (issued.state !== 'ISSUED') return

  // 有效期内复用同一号
  assert.equal((await provisioningReference(deps, identity)).state, 'REUSED')

  // 模拟被受控开通消费
  const id = identityId(APP_ID, 'o1')
  await db.tx(async (tx) => {
    const doc = await tx.get(COLLECTIONS.identities, id)
    if (!doc) throw new Error('夹具：identity 缺失')
    await tx.set(COLLECTIONS.identities, { ...doc, ownerReferenceUsedAt: clock.now() })
  })
  assert.equal((await provisioningReference(deps, identity)).state, 'CONSUMED')
  assert.equal((await provisioningReference(deps, identity, true)).state, 'REPLACED')
})

test('BLOCKED 账户不能签发参考号', async () => {
  const db = new MemoryDatabase()
  const clock = makeClock()
  const deps: AuthDeps = { db, now: clock.now }
  const account = await bootstrap(deps, identity)

  await db.tx(async (tx) => {
    const user = await tx.get(COLLECTIONS.users, account.accountKey)
    if (!user) throw new Error('夹具：user 缺失')
    await tx.set(COLLECTIONS.users, { ...user, securityState: 'BLOCKED' })
  })

  await assert.rejects(
    () => provisioningReference(deps, identity),
    (e: unknown) => (e as { code?: string }).code === 'account_blocked'
  )
})
