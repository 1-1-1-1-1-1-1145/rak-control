import { MemoryDatabase } from '../repositories/store.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import { identityId, memberId } from '../repositories/ids.ts'
import { initializePlatform, provisionTeam, type ProvisioningDeps } from '../modules/provisioning/index.ts'
import { bootstrap, provisioningReference, type AuthDeps } from '../modules/auth/index.ts'
import type { TrustedIdentity } from '../shared/identity.ts'

/** 本地测试夹具（**替身层**，不代表真实云鉴权）。 */

export const APP_ID = 'wxa8bf102dcfdcec4c'
export const ENV = 'cloud1-test'

export interface Clock {
  now: () => number
  advance: (ms: number) => void
  set: (value: number) => void
}

export function makeClock(start = 1_700_000_000_000): Clock {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
    set: (value: number) => {
      t = value
    },
  }
}

/** 由毫秒时间构造合法 UUIDv7（用于命令 mutationId）。 */
export function uuidV7From(ms: number, seq: number): string {
  const time = Math.max(0, Math.floor(ms)).toString(16).padStart(12, '0').slice(-12)
  const rand = `${seq.toString(16).padStart(8, '0')}abcdef12abcdef12`.slice(0, 18)
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${rand.slice(0, 3)}-8${rand.slice(3, 6)}-${rand.slice(6, 18)}`
}

/** 生成随当前时钟推进的合法 mutationId 工厂（每次调用唯一）。 */
export function mutationFactory(clock: Clock): () => string {
  let seq = 0
  return () => uuidV7From(clock.now(), (seq += 1))
}

/** 由标签稳定派生 UUIDv7（同标签同时刻→同 id，跨推进时钟→仍新鲜）。 */
export function labelIds(clock: Clock): (label: string) => string {
  return (label: string) => {
    let h = 0
    for (let i = 0; i < label.length; i += 1) h = (h * 31 + label.charCodeAt(i)) >>> 0
    return uuidV7From(clock.now(), h)
  }
}

function clubIdFactory() {
  let counter = 0
  return () => `club${String((counter += 1)).padStart(6, '0')}`
}

export interface PlatformSetup {
  db: MemoryDatabase
  clock: Clock
  authDeps: AuthDeps
  provDeps: ProvisioningDeps
  ownerIdentity: TrustedIdentity
  code: string
}

/** 建库 → bootstrap → 参考号 → 平台初始化。返回可继续开通的上下文。 */
export async function setupPlatform(openid = 'owner-openid'): Promise<PlatformSetup> {
  const db = new MemoryDatabase()
  const clock = makeClock()
  const authDeps: AuthDeps = { db, now: clock.now }
  const provDeps: ProvisioningDeps = { db, now: clock.now, newClubId: clubIdFactory() }
  const ownerIdentity: TrustedIdentity = { appId: APP_ID, openid, env: ENV }

  await bootstrap(authDeps, ownerIdentity)
  const ref = await provisioningReference(authDeps, ownerIdentity)
  if (ref.state !== 'ISSUED') throw new Error('夹具：参考号未签发')
  await initializePlatform(provDeps, APP_ID)
  return { db, clock, authDeps, provDeps, ownerIdentity, code: ref.code }
}

export interface SeedResult extends PlatformSetup {
  clubId: string
  ownerMemberId: string
  ownerUserId: string
}

/** 完整种子：平台 + 一个含 owner 的团队。 */
export async function seedTeam(): Promise<SeedResult> {
  const setup = await setupPlatform()
  const account = await bootstrap(setup.authDeps, setup.ownerIdentity)
  const result = await provisionTeam(setup.provDeps, {
    provisioningKey: 'k1',
    appId: APP_ID,
    env: ENV,
    clubName: '摄影社',
    slug: 'photo',
    displayCode: 'A7K2',
    ownerReferenceCode: setup.code,
    ownerDisplayName: '王同学',
  })
  return { ...setup, clubId: result.clubId, ownerMemberId: result.ownerMemberId, ownerUserId: account.accountKey }
}

export interface AddedMember {
  userId: string
  memberId: string
  identity: TrustedIdentity
}

/** 直接写入一个已有身份/账户的成员（模拟已入会用户）。 */
export async function addMemberWithIdentity(
  db: MemoryDatabase,
  clubId: string,
  openid: string,
  displayName: string,
  role: 'member' | 'manager' | 'super_admin',
  status: 'ACTIVE' | 'LEFT' | 'DISABLED' = 'ACTIVE'
): Promise<AddedMember> {
  const userId = `user-${openid}`
  const idId = identityId(APP_ID, openid)
  const mId = memberId(clubId, userId)
  await db.tx(async (tx) => {
    await tx.set(COLLECTIONS.identities, { _id: idId, appId: APP_ID, openid, userId, createdAt: 1, updatedAt: 1 })
    await tx.set(COLLECTIONS.users, {
      _id: userId,
      securityState: 'NORMAL',
      securityMutationSeq: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await tx.set(COLLECTIONS.members, {
      _id: mId,
      clubId,
      userId,
      displayName,
      duty: null,
      role,
      status,
      createdAt: 1,
      joinedAt: 1,
      revision: 1,
      mutationSeq: 0,
    })
  })
  return { userId, memberId: mId, identity: { appId: APP_ID, openid, env: ENV } }
}

/** 读一个成员的 revision（用于构造期望值）。 */
export async function readRevision(db: MemoryDatabase, memberDocId: string): Promise<number> {
  return ((await db.read(COLLECTIONS.members, memberDocId))?.revision as number) ?? 0
}

/** 读一个成员的 mutationSeq（验证写栅栏）。 */
export async function readMutationSeq(db: MemoryDatabase, memberDocId: string): Promise<number> {
  return ((await db.read(COLLECTIONS.members, memberDocId))?.mutationSeq as number) ?? 0
}
