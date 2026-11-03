import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useRef, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, HeroBlock, StatusPill, TaskCard, Tile, TileGrid } from '@/components/ui'
import { ErrorView, Skeleton } from '@/components/states'
import { authStore, uiStore } from '@/store'
import * as taskService from '@/services/task'
import * as roiService from '@/services/roi'
import * as clubService from '@/services/club'
import { cloudTaskList } from '@/services/cloud/task'
import { cloudClubDashboard } from '@/services/cloud/club'
import { cloudRoiOverview } from '@/services/cloud/roi'
import { toLegacyRoiOverview, toLegacyTask } from '@/services/cloud/legacy-view'
import { ROUTES } from '@/constants'
import { formatMoney2, formatRoiRatio } from '@/utils/format'
import { ApiError } from '@/utils/request'
import type { Announcement, RoiOverview, Task } from '@/types/domain'
import './index.scss'

interface HomeData {
  myActive: Task[]
  openCount: number
  reviewCount: number
  roi: RoiOverview | null
  announcements: Announcement[]
}

function Home() {
  const [data, setData] = useState<HomeData | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadGeneration = useRef(0)

  const load = async () => {
    if (authStore.isCloud) return loadCloud()
    if (!authStore.isLoggedIn) return
    const generation = ++loadGeneration.current
    try {
      const uid = authStore.user?.id || ''
      const [mine, open, review, roi, anns] = await Promise.all([
        taskService.fetchTasks({ assigneeId: uid, status: 'CLAIMED,SUBMITTED,REJECTED', size: 3 }),
        taskService.fetchTasks({ status: 'OPEN', size: 1 }),
        authStore.isManager
          ? taskService.fetchTasks({ status: 'SUBMITTED', size: 1 })
          : Promise.resolve(null),
        roiService.fetchRoiOverview('month').catch(() => null),
        clubService.fetchAnnouncements(0, 3).catch(() => null),
      ])
      if (generation !== loadGeneration.current) return
      setData({
        myActive: mine.items,
        openCount: open.total,
        reviewCount: review?.total ?? 0,
        roi,
        announcements: anns?.items.filter((a) => a.status === 'PUBLISHED').slice(0, 2) || [],
      })
      setLoadError(null)
    } catch (error) {
      if (generation !== loadGeneration.current) return
      setLoadError(
        error instanceof ApiError
          ? error.userMessage
          : '首页数据加载失败，请检查网络后重试'
      )
    } finally {
      if (generation === loadGeneration.current) setReady(true)
    }
  }

  /**
   * cloud 首页：计数用 `club.dashboard` 显式摘要（**不伪造 total**），
   * ROI 用一次聚合概览；结果落库前二次校验捕获的 clubId（A 结果不回填 B）。
   */
  const loadCloud = async () => {
    const team = authStore.cloudActiveTeam
    if (!team || authStore.cloudTeamState !== 'READY') return
    const clubId = team.clubId
    const generation = ++loadGeneration.current
    try {
      const [dashboard, mine, roiRaw] = await Promise.all([
        cloudClubDashboard(clubId),
        cloudTaskList(clubId, {
          assigneeMemberId: team.memberId,
          status: ['CLAIMED', 'SUBMITTED', 'REJECTED'],
          pageSize: 3,
        }),
        cloudRoiOverview(clubId, 'month').catch(() => null),
      ])
      if (generation !== loadGeneration.current) return
      if (authStore.cloudActiveTeam?.clubId !== clubId) return
      setData({
        myActive: mine.items.map(toLegacyTask),
        openCount: dashboard.openTaskCount,
        reviewCount: dashboard.pendingReviewCount ?? 0,
        roi: roiRaw ? toLegacyRoiOverview(roiRaw) : null,
        announcements: dashboard.latestPublishedAnnouncements.slice(0, 2).map((item) => ({
          id: item.announcementId,
          clubId,
          title: item.title,
          body: '',
          pinned: item.pinned,
          authorId: '',
          authorName: null,
          status: 'PUBLISHED' as const,
          publishedAt: item.publishedAt,
          createdAt: item.createdAt,
          updatedAt: item.createdAt,
        })) as Announcement[],
      })
      setLoadError(null)
    } catch {
      if (generation !== loadGeneration.current) return
      setLoadError('首页数据加载失败，请检查网络后重试')
    } finally {
      if (generation === loadGeneration.current) setReady(true)
    }
  }

  useDidShow(() => {
    uiStore.syncTabBarStyle()
    if (authStore.status === 'LOADING') return
    // cloud：未就绪时交由 PageShell 统一守卫决定落点（选队/账户页），不在此跳登录
    if (!authStore.isCloud && !authStore.isLoggedIn) {
      Taro.reLaunch({ url: ROUTES.login })
      return
    }
    void load()
  })

  usePullDownRefresh(async () => {
    await load()
    Taro.stopPullDownRefresh()
  })

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 6) return '夜深了'
    if (h < 12) return '早上好'
    if (h < 18) return '下午好'
    return '晚上好'
  }

  return (
    <PageShell
      kicker='HOME'
      headTitle={`${greeting()}，${authStore.user?.displayName || '成员'}`}
      headStatus={
        authStore.isManager && ready && data && data.reviewCount > 0 ? (
          <StatusPill dot text={`${data.reviewCount} 个待验收`} />
        ) : (
          <StatusPill text={authStore.club?.name || 'Rak'} />
        )
      }
    >
      {!ready && !data ? (
        <Skeleton rows={4} />
      ) : loadError && !data ? (
        <ErrorView message={loadError} onRetry={() => void load()} />
      ) : data ? (
        <View className='stack-gap fade-in home-dashboard'>
          {loadError ? <ErrorView message={loadError} onRetry={() => void load()} /> : null}
          {/* hero：本月 ROI 速览 */}
          <HeroBlock
            variant='metric'
            onClick={() => Taro.switchTab({ url: ROUTES.roiOverview })}
          >
            <Text className='hero-block__desc'>本月净额（元）</Text>
            <View className='home-hero-metrics'>
              <Text className='text-display-mono'>¥{formatMoney2(data.roi?.net ?? 0)}</Text>
              <Text
                className={`home-hero-ratio ${
                  data.roi?.roiRatio !== null && data.roi?.roiRatio !== undefined && data.roi.roiRatio >= 0
                    ? 'text-success'
                    : 'text-destructive'
                }`}
              >
                ROI {formatRoiRatio(data.roi?.roiRatio ?? null)}
              </Text>
            </View>
            {data.roi && data.roi.series.length > 0 ? (
              <MiniBars series={data.roi.series} />
            ) : null}
          </HeroBlock>

          {/* 宫格入口 */}
          <TileGrid>
            <Tile
              face='solid'
              mark='arrow'
              title='任务池'
              desc={`${data.openCount} 个任务在池可领`}
              onClick={() => Taro.switchTab({ url: ROUTES.taskPool })}
            />
            {authStore.isManager ? (
              <Tile
                face='white'
                mark={data.reviewCount > 0 ? 'check' : 'arrow'}
                title='任务验收'
                desc={data.reviewCount > 0 ? `${data.reviewCount} 个等待验收` : '暂无待验收'}
                onClick={() => Taro.navigateTo({ url: ROUTES.adminReview })}
              />
            ) : (
              <Tile
                face='white'
                mark='arrow'
                title='公告'
                desc='查看社团最新'
                onClick={() => Taro.navigateTo({ url: ROUTES.announcements })}
              />
            )}
            {authStore.isManager ? (
              <>
                <Tile
                  face='white'
                  mark='arrow'
                  title='发布任务'
                  desc='指派与奖励一并填'
                  onClick={() => Taro.navigateTo({ url: ROUTES.adminTaskPublish })}
                />
                <Tile
                  face='paper'
                  mark='arrow'
                  title='邀请码'
                  desc='生成新成员入口'
                  onClick={() => Taro.navigateTo({ url: ROUTES.adminInvites })}
                />
              </>
            ) : null}
          </TileGrid>

          {/* 我的进行中 */}
          <View>
            <View className='row-between'>
              <Text className='section-label home-section-title'>我的进行中</Text>
              <Text
                className='text-caption text-brand home-section-action'
                onClick={() => Taro.switchTab({ url: ROUTES.taskPool })}
              >
                全部任务 ›
              </Text>
            </View>
            <Card>
              {data.myActive.length === 0 ? (
                <View className='home-empty-clickable' onClick={() => Taro.switchTab({ url: ROUTES.taskPool })}>
                  <Text className='text-caption home-empty-copy'>当前没有进行中的任务，去任务池看看？</Text>
                </View>
              ) : (
                <View className='stack-gap'>
                  {data.myActive.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      compact
                      onPress={() =>
                        Taro.navigateTo({ url: `${ROUTES.taskDetail}?id=${t.id}` })
                      }
                    />
                  ))}
                </View>
              )}
            </Card>
          </View>

          {/* 置顶/最新公告 */}
          <View>
            <View className='row-between'>
              <Text className='section-label home-section-title'>公告</Text>
              <Text
                className='text-caption text-brand home-section-action'
                onClick={() => Taro.navigateTo({ url: ROUTES.announcements })}
              >
                全部 ›
              </Text>
            </View>
            <Card>
              {data.announcements.length === 0 ? (
                <Text className='text-caption home-empty-copy'>最近没有新公告</Text>
              ) : (
                data.announcements.map((a) => (
                  <View
                    key={a.id}
                    className='list-row list-row--pressable home-announcement'
                    onClick={() =>
                      Taro.navigateTo({
                        url: `${ROUTES.announcementDetail}?id=${a.id}`,
                      })
                    }
                  >
                    <View className='flex-1 home-announcement__content'>
                      <Text className='text-card-title home-announcement__title'>
                        {a.pinned ? '📌 ' : ''}
                        {a.title}
                      </Text>
                      <Text className='text-caption home-announcement__meta'>
                        {a.authorName || ''} · {a.publishedAt?.slice(0, 10) || ''}
                      </Text>
                    </View>
                    <Text className='text-caption home-announcement__arrow'>›</Text>
                  </View>
                ))
              )}
            </Card>
          </View>
        </View>
      ) : (
        <Skeleton rows={4} />
      )}
    </PageShell>
  )
}

/** 首页迷你双柱（近 6 月成本/收益，纯 view） */
function MiniBars({ series }: { series: RoiOverview['series'] }) {
  const max = Math.max(1, ...series.flatMap((s) => [s.cost, s.revenue]))
  return (
    <View className='bar-chart' style={{ height: '140rpx', marginTop: '16rpx' }}>
      {series.map((s) => (
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
  )
}

export default observer(Home)
