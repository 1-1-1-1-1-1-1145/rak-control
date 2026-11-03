import { getCloudClient } from '../backend'
import type { PerformancePage, PerformanceView } from './dto'

/** 本队绩效（多团队 DESIGN §M6、BASE-DESIGN §10.2）。mine 只本人；list 仅 manager+。 */

export function cloudPerformanceMine(clubId: string): Promise<PerformanceView> {
  return getCloudClient().call<PerformanceView>('rakApi', 'performance.mine', { kind: 'TEAM', clubId }, {})
}

export function cloudPerformanceList(
  clubId: string,
  opts: { cursor?: string; pageSize?: number } = {}
): Promise<PerformancePage> {
  return getCloudClient().call<PerformancePage>('rakApi', 'performance.list', { kind: 'TEAM', clubId }, opts)
}
