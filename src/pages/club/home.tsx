import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, HeroBlock, RoleBadge, StatusPill, Tile, TileGrid } from '@/components/ui'
import { Skeleton } from '@/components/states'
import { authStore, roiStore, teamStore } from '@/store'
import { ROUTES } from '@/constants'
import { formatRoiRatio } from '@/utils/format'
import './club.scss'

function ClubHome() {
  const [ready, setReady] = useState(false)

  useDidShow(() => {
    if (authStore.status === 'LOADING') return
    // cloud：未就绪时交由 PageShell 统一守卫决定落点（选队/账户页），不在此跳登录
    if (!authStore.isCloud && !authStore.isLoggedIn) {
      Taro.reLaunch({ url: ROUTES.login })
      return
    }
    void Promise.all([
      teamStore.loadMembers(),
      teamStore.loadAnnouncements(0),
      authStore.isManager ? teamStore.loadPerformance() : Promise.resolve(),
      authStore.isManager ? roiStore.loadOverview() : Promise.resolve(),
    ]).finally(() => setReady(true))
  })

  usePullDownRefresh(async () => {
    await Promise.all([
      teamStore.loadMembers(),
      teamStore.loadAnnouncements(0),
      authStore.isManager ? teamStore.loadPerformance() : Promise.resolve(),
    ])
    Taro.stopPullDownRefresh()
  })

  const uid = authStore.user?.id
  const perfMap = new Map(teamStore.allPerformance.map((p) => [p.userId, p]))
  const topPerf = teamStore.allPerformance.slice(0, 5)
  const activeCount = teamStore.members.filter((m) => m.status === 'ACTIVE').length
  const latestAnn = teamStore.announcements.find((a) => a.pinned) || teamStore.announcements[0]

  return (
    <PageShell
      kicker='CLUB'
      headTitle={authStore.club?.name || 'Rak'}
      headStatus={<StatusPill dot text={`在册 ${activeCount} 人`} />}
    >
      {!ready ? (
        <Skeleton rows={3} />
      ) : (
        <View className='stack-gap fade-in'>
          {/* 最新/置顶公告 hero */}
          {latestAnn ? (
            <HeroBlock
              title={latestAnn.title}
              desc={`${latestAnn.authorName || ''} · ${latestAnn.publishedAt?.slice(0, 10) || ''}`}
              onClick={() =>
                Taro.navigateTo({ url: `${ROUTES.announcementDetail}?id=${latestAnn.id}` })
              }
            />
          ) : null}

          {/* 入口宫格 */}
          <TileGrid>
            <Tile
              face='solid'
              mark='arrow'
              title='成员目录'
              desc={`${activeCount} 人名册`}
              onClick={() => Taro.navigateTo({ url: ROUTES.members })}
            />
            <Tile
              face='white'
              mark='arrow'
              title='全部公告'
              desc='查看历史通知'
              onClick={() => Taro.navigateTo({ url: ROUTES.announcements })}
            />
            <Tile
              face='white'
              mark='arrow'
              title='我的绩效'
              desc='完成率 × 质量分'
              onClick={() => Taro.navigateTo({ url: ROUTES.myPerformance })}
            />
            {authStore.isManager ? (
              <Tile
                face='paper'
                mark='arrow'
                title='本月经营'
                desc={`ROI ${roiStore.overview ? formatRoiRatio(roiStore.overview.roiRatio) : '—'}`}
                onClick={() => Taro.switchTab({ url: ROUTES.roiOverview })}
              />
            ) : null}
          </TileGrid>

          {/* 公告列表 */}
          <View>
            <Text className='section-label'>公告</Text>
            <Card>
              {teamStore.announcements.length === 0 ? (
                <Text className='text-caption'>暂无公告</Text>
              ) : (
                teamStore.announcements.slice(0, 3).map((a) => (
                  <View
                    key={a.id}
                    className='list-row list-row--pressable'
                    onClick={() =>
                      Taro.navigateTo({ url: `${ROUTES.announcementDetail}?id=${a.id}` })
                    }
                  >
                    <View className='flex-1 club-announcement-copy'>
                      <Text className='text-card-title club-announcement-title'>
                        {a.pinned ? '📌 ' : ''}
                        {a.title}
                      </Text>
                      <Text className='text-caption club-announcement-author'>
                        {a.authorName || ''}
                      </Text>
                    </View>
                    <Text className='text-caption club-announcement-arrow'>›</Text>
                  </View>
                ))
              )}
            </Card>
          </View>

          {/* 绩效榜（manager+） */}
          {authStore.isManager ? (
            <View>
              <Text className='section-label'>综合绩效榜</Text>
              <Card>
                {topPerf.length === 0 ? (
                  <Text className='text-caption'>还没有认领记录</Text>
                ) : (
                  topPerf.map((p, i) => (
                    <View key={p.userId} className='list-row'>
                      <Text className='club-rank'>{i + 1}</Text>
                      <View className='flex-1'>
                        <View className='row-gap'>
                          <Text className='text-card-title'>{p.displayName || '成员'}</Text>
                          <RoleBadge role={p.role} />
                        </View>
                        <Text className='text-caption'>
                          {p.duty || '成员'} · 通过 {p.approvedCount}/{p.claimedCount}
                        </Text>
                      </View>
                      <Text className='metric-value text-brand'>{p.compositeScore}</Text>
                    </View>
                  ))
                )}
              </Card>
            </View>
          ) : (
            perfMap.get(uid || '') ? (
              <Card>
                <View
                  className='row-between'
                  onClick={() => Taro.navigateTo({ url: ROUTES.myPerformance })}
                >
                  <View>
                    <Text className='text-card-title'>我的绩效</Text>
                    <Text className='text-caption'>完成率 × 质量分</Text>
                  </View>
                  <Text className='metric-value text-brand'>
                    {perfMap.get(uid || '')!.compositeScore}
                  </Text>
                </View>
              </Card>
            ) : null
          )}
        </View>
      )}
    </PageShell>
  )
}

export default observer(ClubHome)
