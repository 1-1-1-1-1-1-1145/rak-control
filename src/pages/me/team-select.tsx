import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useCallback, useEffect, useRef, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, StatusPill } from '@/components/ui'
import { authStore } from '@/store'
import { ROUTES } from '@/constants'
import { roleLabel } from '@/utils/permission'
import { shouldLoadTeamList } from '@/utils/startup-policy'
import './team-select.scss'

/**
 * 切换团队（多团队 DESIGN §9.2、PLAN M7）。
 *
 * - 常显本人关联团队；点选即走协调器（脏编辑确认 / 迟到结果栅栏 / 失败回选择页）。
 * - 0 队、待审、停用、维护、网络失败均有确定落点；**不展示跨队汇总**。
 * - 本页是选队落点，不被 requiresTeam 守卫循环拦截（PageShell 已按路由豁免）。
 *
 * 缺陷修复（2026-10-18 体验版）：
 * - 原实现只在 `useDidShow` 里拉列表，且"账户未识别就 return"；若那一次早于 bootstrap 完成，
 *   列表**永不加载**（表现为永久空态/卡在选队页）。现补 `useEffect` 在识别完成后补拉一次。
 * - 请求单飞：`useDidShow` 与识别回调可能紧邻触发，只发一次。
 * - 账户未识别时显式提示"正在识别"，不再误显示"还没有可用团队"。
 */
function TeamSelect() {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inFlight = useRef<Promise<void> | null>(null)
  const identifiedLoadDone = useRef(false)

  const teams = authStore.myTeams
  const lastSelected = authStore.lastSelectedClubId

  /** 单飞刷新：并发调用复用同一 Promise（避免 onShow + 识别回调双请求）。 */
  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const request = (async () => {
      try {
        setLoading(true)
        await authStore.loadMyTeams()
      } finally {
        setLoading(false)
        inFlight.current = null
      }
    })()
    inFlight.current = request
    return request
  }, [])

  /** 仅在"cloud + 账户已识别 + 无在途请求"时拉取（未识别不发请求）。 */
  const tryRefresh = useCallback(async (): Promise<void> => {
    if (
      !shouldLoadTeamList({
        isCloud: authStore.isCloud,
        accountIdentified: authStore.cloudAccountIdentified,
        inFlight: inFlight.current !== null,
      })
    ) {
      return
    }
    await refresh()
  }, [refresh])

  async function loadMore() {
    if (inFlight.current) return
    setLoading(true)
    try {
      await authStore.loadMyTeams({ cursor: authStore.myTeamsCursor ?? undefined })
    } finally {
      setLoading(false)
    }
  }

  async function enter(clubId: string, discardLocal = false): Promise<void> {
    setBusyId(clubId)
    try {
      const result = await authStore.switchTeam(clubId, { discardLocal })
      if (result.ok) return
      if (result.reason === 'NEEDS_CONFIRM') {
        const modal = await Taro.showModal({
          title: '有未提交的编辑',
          content: result.message,
          confirmText: '放弃编辑并切换',
          cancelText: '留在当前团队',
        })
        if (modal.confirm) await enter(clubId, true)
        return
      }
      await Taro.showToast({ title: result.message, icon: 'none' })
    } finally {
      setBusyId(null)
    }
  }

  useDidShow(() => {
    void tryRefresh()
  })

  // 账户识别晚于页面首次显示时（冷启动/常规入口/后台恢复）补一次拉取。
  useEffect(() => {
    if (!authStore.cloudAccountIdentified) return
    if (identifiedLoadDone.current) return
    identifiedLoadDone.current = true
    void tryRefresh()
  }, [authStore.cloudAccountIdentified, tryRefresh])

  function statusText(status: string, canEnter: boolean): string {
    if (status === 'DISABLED') return '已停用'
    if (status === 'LEFT') return '已离队'
    if (status === 'ACTIVE') return canEnter ? '可进入' : '待处理'
    return '待处理'
  }

  return (
    <PageShell kicker='TEAMS' headTitle='切换团队' subtitle='选择要进入的团队'>
      <View className='stack-gap fade-in'>
        {!authStore.isCloud ? (
          <Card>
            <Text className='text-card-title'>当前构建不支持多团队</Text>
            <Text className='text-caption'>多团队切换仅在云端正式包提供。</Text>
          </Card>
        ) : null}

        {authStore.isCloud && !authStore.cloudAccountIdentified ? (
          <Card>
            <Text className='text-card-title'>正在识别身份</Text>
            <Text className='text-caption'>正在与微信账户确认身份，请稍候…</Text>
          </Card>
        ) : null}

        {authStore.isCloud && authStore.cloudAccountIdentified && authStore.myTeamsError ? (
          <Card>
            <Text className='text-card-title'>加载失败</Text>
            <Text className='text-caption'>{authStore.myTeamsError}</Text>
            <View className='btn-secondary pressable' onClick={() => void tryRefresh()}>
              <Text>重试</Text>
            </View>
          </Card>
        ) : null}

        {authStore.isCloud &&
        authStore.cloudAccountIdentified &&
        !authStore.myTeamsError &&
        !loading &&
        teams.length === 0 ? (
          <Card>
            <Text className='text-card-title'>还没有可用团队</Text>
            <Text className='text-caption'>通过团队邀请码或入队申请加入后，即可在此切换。</Text>
          </Card>
        ) : null}

        {teams.map((team) => {
          const disabled = !team.canEnter || team.status !== 'ACTIVE' || busyId !== null
          return (
            <View
              key={team.clubId}
              className={`team-row${disabled ? ' team-row--disabled' : ' pressable'}`}
              onClick={() => {
                if (!disabled) void enter(team.clubId)
              }}
            >
              <View className='flex-1'>
                <Text className='text-card-title'>{team.name}</Text>
                <Text className='text-caption'>
                  {team.displayCode} · {roleLabel(team.role)}
                </Text>
              </View>
              {team.clubId === lastSelected ? <StatusPill text='上次使用' /> : null}
              <StatusPill text={busyId === team.clubId ? '切换中…' : statusText(team.status, team.canEnter)} />
            </View>
          )
        })}

        {authStore.isCloud && authStore.myTeamsHasMore ? (
          <View className='btn-secondary pressable' onClick={() => void loadMore()}>
            <Text>{loading ? '加载中…' : '加载更多'}</Text>
          </View>
        ) : null}

        <View className='btn-secondary pressable' onClick={() => Taro.navigateTo({ url: ROUTES.teamJoin })}>
          <Text>加入其他团队</Text>
        </View>
      </View>
    </PageShell>
  )
}

export default observer(TeamSelect)
