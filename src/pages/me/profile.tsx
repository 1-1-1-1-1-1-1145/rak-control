import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, RoleBadge, StatusPill, Tile, TileGrid } from '@/components/ui'
import { authStore, uiStore } from '@/store'
import * as taskService from '@/services/task'
import { cloudProfileSummary } from '@/services/cloud/club'
import type { CloudProfileSummaryView } from '@/services/cloud/dto'
import { ROUTES } from '@/constants'
import { canManage, isSuper, roleLabel } from '@/utils/permission'
import './me.scss'

/**
 * 我的（多团队 DESIGN §9.2、BASE-DESIGN §10.3、PLAN M7）。
 *
 * - cloud：常显当前队 name/displayCode 与**本队**姓名/职务/role，并给"切换团队"入口；
 *   计数来自 `profile.summary`（显式摘要，不伪造 total），且以捕获的 clubId 二次校验（A 结果不回填 B）。
 * - 无可用队：只展示账户/入队入口，**不加载内部宫格**。
 */
function Profile() {
  const [myCount, setMyCount] = useState<{ active: number; review: number } | null>(null)
  const [cloudSummary, setCloudSummary] = useState<CloudProfileSummaryView | null>(null)
  const isCloud = authStore.isCloud
  const activeTeam = authStore.cloudActiveTeam
  const hasTeam = isCloud ? !!activeTeam : authStore.isLoggedIn
  const uid = authStore.user?.id

  useDidShow(() => {
    if (isCloud) {
      if (authStore.cloudTeamState !== 'READY' || !activeTeam) return
      uiStore.syncTabBarStyle()
      const capturedClubId = activeTeam.clubId
      void (async () => {
        try {
          const summary = await cloudProfileSummary(capturedClubId)
          // 二次校验原 ctx：切队后迟到结果不得回填新队
          if (authStore.cloudActiveTeam?.clubId !== capturedClubId) return
          setCloudSummary(summary)
        } catch {
          setCloudSummary(null)
        }
      })()
      return
    }
    if (authStore.status === 'LOADING') return
    // cloud：未就绪时交由 PageShell 统一守卫决定落点（选队/账户页），不在此跳登录
    if (!authStore.isCloud && !authStore.isLoggedIn) {
      Taro.reLaunch({ url: ROUTES.login })
      return
    }
    uiStore.syncTabBarStyle()
    void (async () => {
      try {
        const [active, review] = await Promise.all([
          taskService.fetchTasks({ assigneeId: uid, status: 'CLAIMED,REJECTED', size: 1 }),
          taskService.fetchTasks({ assigneeId: uid, status: 'SUBMITTED', size: 1 }),
        ])
        setMyCount({ active: active.total, review: review.total })
      } catch {
        setMyCount(null)
      }
    })()
  })

  const name = activeTeam?.displayName || authStore.user?.displayName || '成员'
  const clubLine = isCloud
    ? activeTeam
      ? `${activeTeam.clubName} · ${activeTeam.displayCode}`
      : '未进入团队'
    : authStore.club?.name || ''
  const countText = isCloud
    ? cloudSummary
      ? `进行中 ${cloudSummary.taskCounts.inProgress} · 已通过 ${cloudSummary.taskCounts.approved}`
      : '—'
    : myCount
      ? `进行中 ${myCount.active} · 待验收 ${myCount.review}`
      : '—'

  return (
    <PageShell kicker='ME' headTitle={name} headStatus={<RoleBadge role={authStore.clubRole} />}>
      <View className='stack-gap fade-in'>
        {/* 身份信息卡 */}
        <Card>
          <View className='me-hero'>
            <View className='avatar-dot avatar-dot--lg'>
              <Text>{name.slice(0, 1)}</Text>
            </View>
            <View className='flex-1'>
              <Text className='text-card-title'>
                {activeTeam?.duty || authStore.user?.duty || roleLabel(authStore.clubRole)}
              </Text>
              <Text className='text-caption'>{clubLine}</Text>
            </View>
            <StatusPill text={countText} />
          </View>
        </Card>

        {!hasTeam ? (
          <>
            {/* 无可用队：只给账户/入队入口，不加载内部宫格 */}
            <Card>
              <Text className='text-card-title'>还没有可用团队</Text>
              <Text className='text-caption'>用邀请码或入队链接加入后，即可切换进入。</Text>
            </Card>
            <TileGrid>
              <Tile
                face='solid'
                mark='arrow'
                title='加入团队'
                desc='邀请码或入队链接'
                onClick={() => Taro.navigateTo({ url: ROUTES.teamJoin })}
              />
              <Tile
                face='white'
                mark='arrow'
                title='入队进度'
                desc='查看申请状态'
                onClick={() => Taro.navigateTo({ url: ROUTES.teamJoinStatus })}
              />
              <Tile
                face='paper'
                mark='arrow'
                title='账户'
                desc='退出登录与设备设置'
                onClick={() => Taro.navigateTo({ url: ROUTES.account })}
              />
            </TileGrid>
          </>
        ) : (
          <>
            <TileGrid>
              <Tile
                face='solid'
                mark='arrow'
                title='切换团队'
                desc='本微信加入的其他团队'
                onClick={() => Taro.navigateTo({ url: ROUTES.teamSelect })}
              />
              <Tile
                face='white'
                mark='arrow'
                title='我的任务'
                desc={myCount ? `${myCount.active} 个进行中` : '认领与交付记录'}
                onClick={() => Taro.navigateTo({ url: ROUTES.myTasks })}
              />
              <Tile
                face='white'
                mark='arrow'
                title='我的绩效'
                desc='完成率 × 质量分'
                onClick={() => Taro.navigateTo({ url: ROUTES.myPerformance })}
              />
              {canManage(authStore.clubRole) ? (
                <Tile
                  face='white'
                  mark='arrow'
                  title='管理面板'
                  desc='发布 · 验收 · ROI'
                  onClick={() => Taro.navigateTo({ url: ROUTES.adminHome })}
                />
              ) : null}
              {isSuper(authStore.clubRole) ? (
                <Tile
                  face='white'
                  mark='arrow'
                  title='超级后台'
                  desc='任免 · 全量视图'
                  onClick={() => Taro.navigateTo({ url: ROUTES.superRoles })}
                />
              ) : null}
              <Tile
                face='white'
                mark='arrow'
                title='成员目录'
                desc='查看团队名册'
                onClick={() => Taro.navigateTo({ url: ROUTES.members })}
              />
              <Tile
                face='white'
                mark='arrow'
                title='本队资料'
                desc='姓名与职务'
                onClick={() => Taro.navigateTo({ url: ROUTES.teamProfile })}
              />
              <Tile
                face='paper'
                mark='arrow'
                title='账户'
                desc='开通参考号 · 退出'
                onClick={() => Taro.navigateTo({ url: ROUTES.account })}
              />
              <Tile
                face='paper'
                mark='arrow'
                title='设置'
                desc='主题与账号'
                onClick={() => Taro.navigateTo({ url: ROUTES.settings })}
              />
            </TileGrid>

            <View
              className='btn-secondary pressable'
              onClick={() => {
                void Taro.showModal({ title: '退出登录', content: '确定退出 Rak？' }).then((r) => {
                  if (r.confirm) void authStore.logout()
                })
              }}
            >
              <Text>退出登录</Text>
            </View>
          </>
        )}
      </View>
    </PageShell>
  )
}

export default observer(Profile)
