import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useRef, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card } from '@/components/ui'
import { Skeleton, EmptyView } from '@/components/states'
import { authStore } from '@/store'
import * as taskService from '@/services/task'
import { cloudPerformanceMine } from '@/services/cloud/performance'
import { toLegacyPerformance } from '@/services/cloud/legacy-view'
import { ROUTES } from '@/constants'
import { formatRoiRatio } from '@/utils/format'
import type { MemberPerformance } from '@/types/domain'
import './me.scss'

function MyPerformance() {
  const [perf, setPerf] = useState<MemberPerformance | null>(null)
  const [loading, setLoading] = useState(true)
  const uid = authStore.user?.id
  /** 本页异步回调 ctx 栅栏：切队后迟到结果不得写入 */
  const loadGeneration = useRef(0)

  const load = async () => {
    const generation = ++loadGeneration.current
    setLoading(true)
    try {
      if (authStore.isCloud) {
        const team = authStore.cloudActiveTeam
        if (!team || authStore.cloudTeamState !== 'READY') return
        const clubId = team.clubId
        const view = await cloudPerformanceMine(clubId)
        if (generation !== loadGeneration.current) return
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        setPerf(toLegacyPerformance(view))
        return
      }
      if (!uid) return
      const legacy = await taskService.fetchMemberPerformance(uid)
      if (generation !== loadGeneration.current) return
      setPerf(legacy)
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }

  useDidShow(() => {
    void load()
  })

  const score = perf?.compositeScore ?? 0
  const ringPct = Math.min(100, score)

  return (
    <PageShell kicker='PERFORMANCE' headTitle='我的绩效' showBack>
      {loading ? (
        <Skeleton rows={2} />
      ) : !perf || perf.claimedCount === 0 ? (
        <EmptyView
          title='还没有绩效数据'
          hint='认领并通过验收任务后，这里会生成你的综合分'
          action={
            <View
              className='btn-primary pressable'
              onClick={() => Taro.switchTab({ url: ROUTES.taskPool })}
            >
              <Text>去认领任务</Text>
            </View>
          }
        />
      ) : (
        <View className='stack-gap fade-in'>
          <Card>
            <View
              className='perf-ring'
              style={{
                background: `conic-gradient(var(--color-brand) ${ringPct}%, var(--color-surface-2) ${ringPct}%)`,
              }}
            >
              <View className='perf-ring__inner'>
                <Text className='metric-value text-brand' style={{ fontSize: '56rpx' }}>
                  {perf.compositeScore}
                </Text>
                <Text className='text-caption'>综合分</Text>
              </View>
            </View>
            <Text className='text-caption' style={{ textAlign: 'center', display: 'block' }}>
              综合分 = 通过率 × 平均质量分（口径由服务端统一计算）
            </Text>
          </Card>

          <Card>
            <Text className='section-label'>明细</Text>
            <PerfRow label='认领任务' value={`${perf.claimedCount}`} />
            <PerfRow label='通过' value={`${perf.approvedCount}`} tone='success' />
            <PerfRow label='进行中' value={`${perf.inProgressCount}`} />
            <PerfRow label='被驳回过' value={`${perf.rejectedCount}`} tone='destructive' />
            <PerfRow label='通过率' value={formatRoiRatio(perf.completionRate)} />
            <PerfRow
              label='平均质量分'
              value={perf.avgQualityScore === null ? '—' : perf.avgQualityScore.toFixed(1)}
            />
          </Card>
        </View>
      )}
    </PageShell>
  )
}

function PerfRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'success' | 'destructive'
}) {
  return (
    <View className='perf-metric'>
      <Text className='text-muted'>{label}</Text>
      <Text
        className={`text-mono ${tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : ''}`}
      >
        {value}
      </Text>
    </View>
  )
}

export default observer(MyPerformance)
