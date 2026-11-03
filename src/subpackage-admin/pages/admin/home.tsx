import { View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { StatusPill, Tile, TileGrid } from '@/components/ui'
import { authStore, teamStore } from '@/store'
import { cloudClubDashboard } from '@/services/cloud/club'
import { cloudListNewTeamApplications } from '@/services/cloud/club-application'
import * as taskService from '@/services/task'
import * as memberService from '@/services/member'
import { ROUTES } from '@/constants'
import '../../admin.scss'

function AdminHome() {
  /** 计数：`-1` 表示"未知/加载失败"（不显示数字，不伪造 0） */
  const [counts, setCounts] = useState({ review: -1, join: -1, newTeam: -1 })

  useDidShow(() => {
    // cloud：未就绪时交由 PageShell 统一守卫决定落点（选队/账户页），不在此跳登录
    if (!authStore.isCloud && !authStore.isLoggedIn) {
      Taro.reLaunch({ url: ROUTES.login })
      return
    }
    void (async () => {
      if (authStore.isCloud) {
        const team = authStore.cloudActiveTeam
        if (!team || authStore.cloudTeamState !== 'READY') return
        const clubId = team.clubId
        const [dashboard, openTeams] = await Promise.all([
          cloudClubDashboard(clubId).catch(() => null),
          cloudListNewTeamApplications(clubId, { status: 'PENDING' }).catch(() => null),
          teamStore.loadJoinRequests(),
        ])
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        setCounts({
          review: dashboard?.pendingReviewCount ?? -1,
          join: teamStore.joinError ? -1 : teamStore.joinRequests.length,
          newTeam: openTeams ? openTeams.items.length : -1,
        })
        return
      }
      const [review, joinReq] = await Promise.all([
        taskService.fetchTasks({ status: 'SUBMITTED', size: 1 }).catch(() => null),
        memberService.fetchJoinRequests('PENDING').catch(() => []),
      ])
      setCounts({ review: review?.total ?? -1, join: joinReq?.length ?? 0, newTeam: -1 })
      teamStore.joinRequests = joinReq || []
    })()
  })

  const go = (url: string) => Taro.navigateTo({ url })

  return (
    <PageShell
      kicker='CONSOLE'
      headTitle='管理台'
      showBack
      requireRole='manage'
      headStatus={
        counts.review > 0 ? <StatusPill dot text={`${counts.review} 个待验收`} /> : undefined
      }
    >
      <View className='stack-gap fade-in'>
        <TileGrid>
          <Tile
            face='solid'
            mark='arrow'
            title='发布任务'
            desc='写入任务池 · OPEN'
            onClick={() => go(ROUTES.adminTaskPublish)}
          />
          <Tile
            face='solid'
            mark={counts.review > 0 ? 'check' : 'arrow'}
            title='任务验收'
            desc={counts.review > 0 ? `${counts.review} 个待验收` : counts.review === 0 ? '暂无待验收' : '任务验收'}
            onClick={() => go(ROUTES.adminReview)}
          />
          <Tile
            face='white'
            mark='arrow'
            title='录入 ROI'
            desc='收支项目 · 自动算 ROI'
            onClick={() => go(`${ROUTES.adminRoiEdit}?mode=create`)}
          />
          <Tile
            face='white'
            mark='arrow'
            title='项目明细'
            desc='看板与台账'
            onClick={() => go(ROUTES.roiList)}
          />
          <Tile
            face='white'
            mark='arrow'
            title='邀请码'
            desc='生成 / 小程序码 / 作废'
            onClick={() => go(ROUTES.adminInvites)}
          />
          <Tile
            face='white'
            mark='arrow'
            title='公告'
            desc='发布 / 置顶 / 归档'
            onClick={() => go(ROUTES.adminAnnouncements)}
          />
          <Tile
            face='white'
            mark='arrow'
            title='成员管理'
            desc='状态变更 · 名册'
            onClick={() => go(ROUTES.adminMembers)}
          />
          <Tile
            face='white'
            mark={counts.join > 0 ? 'check' : 'arrow'}
            title='申请审批'
            desc={counts.join > 0 ? `${counts.join} 条待处理` : counts.join === 0 ? '暂无待处理' : '管理入队申请'}
            onClick={() => go(ROUTES.adminJoinRequests)}
          />
          {authStore.isCloud ? (
            <Tile
              face='white'
              mark={counts.newTeam > 0 ? 'check' : 'arrow'}
              title='开队审批'
              desc={
                counts.newTeam > 0
                  ? `${counts.newTeam} 条待审批`
                  : counts.newTeam === 0
                    ? '暂无待审批'
                    : '成员开通新团队'
              }
              onClick={() => go(ROUTES.newTeamApplications)}
            />
          ) : null}
          <Tile
            face='white'
            mark='arrow'
            title='裁员管理'
            desc='管理员 + 超管双人审批'
            onClick={() => go(ROUTES.adminDismissals)}
          />
          {authStore.isSuper ? (
            <Tile
              face='paper'
              mark='arrow'
              title='团队解散'
              desc='协助申请 / 跨队解散'
              onClick={() => go(ROUTES.adminDissolutions)}
            />
          ) : null}
          <Tile
            face='paper'
            mark='arrow'
            title='团队设置'
            desc='名称 / 简介 / 目录开关'
            onClick={() => go(ROUTES.adminClubSettings)}
          />
          {authStore.isSuper ? (
            <Tile
              face='paper'
              mark='arrow'
              title='角色任免'
              desc='超级后台 · manager/member'
              onClick={() => go(ROUTES.superRoles)}
            />
          ) : null}
        </TileGrid>
      </View>
    </PageShell>
  )
}

export default observer(AdminHome)
