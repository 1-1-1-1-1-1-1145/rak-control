import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { HeroBlock, StatusPill, Tile, TileGrid } from '@/components/ui'
import { Skeleton } from '@/components/states'
import { authStore, roiStore } from '@/store'
import { ROUTES } from '@/constants'
import { formatMoney2, formatRoiRatio } from '@/utils/format'
import type { RoiPeriod } from '@/types/domain'
import './roi.scss'

const PERIODS: { key: RoiPeriod; label: string }[] = [
  { key: 'month', label: '本月' },
  { key: 'quarter', label: '本季' },
  { key: 'year', label: '本年' },
  { key: 'all', label: '全部' },
]

function RoiOverviewPage() {
  const [ready, setReady] = useState(false)

  useDidShow(() => {
    if (authStore.status === 'LOADING') return
    // cloud：未就绪时交由 PageShell 统一守卫决定落点（选队/账户页），不在此跳登录
    if (!authStore.isCloud && !authStore.isLoggedIn) {
      Taro.reLaunch({ url: ROUTES.login })
      return
    }
    roiStore.loadOverview().finally(() => setReady(true))
  })

  usePullDownRefresh(async () => {
    await roiStore.loadOverview()
    Taro.stopPullDownRefresh()
  })

  const ov = roiStore.overview
  const max = ov ? Math.max(1, ...ov.series.flatMap((s) => [s.cost, s.revenue])) : 1
  const periodLabel = PERIODS.find((p) => p.key === roiStore.period)?.label || '本月'

  if (!ready || !ov) {
    return (
      <PageShell kicker='ROI' headTitle='经营看板'>
        <Skeleton rows={3} />
      </PageShell>
    )
  }

  return (
    <PageShell
      kicker='ROI'
      headTitle='经营看板'
      headStatus={<StatusPill dot text={periodLabel} />}
    >
      <View className='stack-gap fade-in'>
        {/* 期间切换 */}
        <View className='roi-periods'>
          {PERIODS.map((p) => (
            <View
              key={p.key}
              className={`roi-periods__item pressable ${roiStore.period === p.key ? 'roi-periods__item--on' : ''}`}
              onClick={() => roiStore.setPeriod(p.key)}
            >
              <Text>{p.label}</Text>
            </View>
          ))}
        </View>

        {/* hero：净额 + ROI */}
        <HeroBlock variant='metric'>
          <Text className='hero-block__desc'>{periodLabel}净额（元）</Text>
          <View className='home-hero-metrics'>
            <Text className='text-display-mono'>¥{formatMoney2(ov.net)}</Text>
            <Text className='home-hero-ratio'>
              ROI {formatRoiRatio(ov.roiRatio)}
            </Text>
          </View>
        </HeroBlock>

        {/* 收支两指标 */}
        <View className='metric-grid'>
          <View className='metric-card'>
            <Text className='metric-card__label'>总收入</Text>
            <Text className='metric-card__value text-success'>
              ¥{formatMoney2(ov.totalRevenue)}
            </Text>
          </View>
          <View className='metric-card'>
            <Text className='metric-card__label'>总成本</Text>
            <Text className='metric-card__value'>¥{formatMoney2(ov.totalCost)}</Text>
          </View>
        </View>

        {/* 趋势柱图 */}
        <View className='surface-card'>
          <Text className='section-label'>近 6 月趋势 · 共 {ov.itemCount} 项</Text>
          <View className='bar-chart'>
            {ov.series.map((s) => (
              <View key={s.label} className='bar-chart__group'>
                <View className='bar-chart__bars'>
                  <View
                    className='bar-chart__bar bar-chart__bar--cost'
                    style={{ height: `${(s.cost / max) * 100}%` }}
                  />
                  <View
                    className='bar-chart__bar bar-chart__bar--rev'
                    style={{ height: `${(s.revenue / max) * 100}%` }}
                  />
                </View>
                <Text className='bar-chart__label'>{s.label.slice(5)}</Text>
              </View>
            ))}
          </View>
          <View className='roi-legend'>
            <Text className='text-caption'>
              <Text className='legend-dot' style={{ background: 'var(--color-chart-3)' }} />
              成本
            </Text>
            <Text className='text-caption'>
              <Text className='legend-dot' style={{ background: 'var(--color-chart-2)' }} />
              收益
            </Text>
          </View>
        </View>

        {/* 入口宫格 */}
        <TileGrid>
          <Tile
            face='solid'
            mark='arrow'
            title='项目明细'
            desc={`共 ${ov.itemCount} 项`}
            onClick={() => Taro.navigateTo({ url: ROUTES.roiList })}
          />
          {authStore.isManager ? (
            <Tile
              face='white'
              mark='arrow'
              title='录入 ROI'
              desc='新增收支项目'
              onClick={() => Taro.navigateTo({ url: `${ROUTES.adminRoiEdit}?mode=create` })}
            />
          ) : null}
        </TileGrid>
      </View>
    </PageShell>
  )
}

export default observer(RoiOverviewPage)
