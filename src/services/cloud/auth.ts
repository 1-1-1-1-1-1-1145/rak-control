import { getCloudClient } from '../backend'
import type { CloudAccount } from './dto'

/** 云身份/账户（GLOBAL）。authStore 消费 CloudSession 的接线在 M7 页面整合时完成。 */

export function cloudBootstrap(): Promise<CloudAccount> {
  return getCloudClient().call<CloudAccount>('rakApi', 'auth.bootstrap', { kind: 'GLOBAL' })
}

export function cloudMe(): Promise<CloudAccount> {
  return getCloudClient().call<CloudAccount>('rakApi', 'auth.me', { kind: 'GLOBAL' })
}

export function cloudProvisioningReference(replaceConsumed = false): Promise<unknown> {
  return getCloudClient().call(
    'rakApi',
    'account.provisioningReference',
    { kind: 'GLOBAL' },
    replaceConsumed ? { replaceConsumed: true } : {}
  )
}
