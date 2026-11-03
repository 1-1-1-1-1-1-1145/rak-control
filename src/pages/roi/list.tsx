import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { ListState } from '@/components/states'
import { authStore, roiStore } from '@/store'
import { ROUTES } from '@/constants'
import { formatMoney2, formatRoiRatio, formatDate } from '@/utils/format'
import { ROI_CATEGORY_LABEL, ROI_STATUS_LABEL, type RoiStatus } from '@/types/domain'
import './roi.scss'

const STATUS_FILTERS: { key: string; label: string; status?: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'ACTIVE', label: '进行中', status: 'ACTIVE' },
  { key: 'DONE', label: '已完成', status: 'DONE' },
  { key: 'PLANNING', label: '规划中', status: 'PLANNING' },
]

function statusTone(s: RoiStatus): string {
  if (s === 'DONE') return 'success'
  if (s === 'CANCELLED') return 'destructive'
  if (s === 'PLANNING') return ''
  return 'brand'
}

function RoiList() {
  const [filter, setFilter] = useState('all')
  const [ready, setReady] = useState(false)

  const reload = (key: string) => {
    const st = STATUS_FILTERS.find((f) => f.key === key)?.status
    roiStore.setFilters({ status: st })
    setReady(true)
  }

  useDidShow(() => {
    if (authStore.status === 'LOADING') return
    // cloud：未就绪时交由 PageShell 统一守卫决定落点（选队/账户页），不在此跳登录
    if (!authStore.isCloud && !authStore.isLoggedIn) {
      Taro.reLaunch({ url: ROUTES.login })
      return
    }
    reload(filter)
  })

  usePullDownRefresh(async () => {
    await roiStore.loadItems({ reset: true })
    Taro.stopPullDownRefresh()
  })

  useReachBottom(() => {
    void roiStore.loadMore()
  })

  return (
    <PageShell kicker='LEDGER' headTitle='ROI 项目' showBack>
      <View className='pool-seg'>
        {STATUS_FILTERS.map((f) => (
          <View
            key={f.key}
            className={`pool-seg__item pressable ${filter === f.key ? 'pool-seg__item--on' : ''}`}
            onClick={() => {
              setFilter(f.key)
              reload(f.key)
            }}
          >
            <Text>{f.label}</Text>
          </View>
        ))}
      </View>

      <ListState
        loading={roiStore.loading && roiStore.items.length === 0 && !ready}
        error={null}
        empty={roiStore.items.length === 0}
        onRetry={() => roiStore.loadItems({ reset: true })}
        emptyTitle='还没有 ROI 项目'
        emptyHint={authStore.isManager ? '录入第一笔项目/活动收支' : '管理层录入后这里会展示'}
        emptyAction={
          authStore.isManager ? (
            <View
              className='btn-primary pressable'
              onClick={() => Taro.navigateTo({ url: `${ROUTES.adminRoiEdit}?mode=create` })}
            >
              <Text>录入</Text>
            </View>
          ) : null
        }
      >
        <View className='surface-card stagger-item'>
          {roiStore.items.map((it) => (
            <View
              key={it.id}
              className='roi-row pressable'
              onClick={() => Taro.navigateTo({ url: `${ROUTES.roiDetail}?id=${it.id}` })}
            >
              <View className='roi-row__top'>
                <Text className='text-card-title flex-1'>{it.title}</Text>
                <View className={`badge badge--${statusTone(it.status as RoiStatus)}`}>
                  <Text>{ROI_STATUS_LABEL[it.status]}</Text>
                </View>
              </View>
              <View className='roi-row__top'>
                <Text className='text-caption'>
                  {ROI_CATEGORY_LABEL[it.category]} ·{' '}
                  {it.periodStart || it.periodEnd
                    ? `${formatDate(it.periodStart)} ~ ${formatDate(it.periodEnd)}`
                    : formatDate(it.createdAt)}
                </Text>
                <Text
                  className={`text-card-title ${
                    it.roiRatio === null
                      ? ''
                      : it.roiRatio >= 0
                        ? 'text-success'
                        : 'text-destructive'
                  }`}
                >
                  {formatRoiRatio(it.roiRatio)}
                </Text>
              </View>
              <View className='roi-row__amounts'>
                <Text>收 ¥{formatMoney2(it.revenue)}</Text>
                <Text>支 ¥{formatMoney2(it.cost)}</Text>
                <Text>{it.participants} 人参与</Text>
              </View>
            </View>
          ))}
        </View>
        {roiStore.loading && roiStore.items.length > 0 ? (
          <Text className='pool-more'>加载中…</Text>
        ) : null}
      </ListState>
    </PageShell>
  )
}

export default observer(RoiList)
