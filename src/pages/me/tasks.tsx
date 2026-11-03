import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useRef, useState } from 'react'
import PageShell from '@/components/page-shell'
import { TaskCard } from '@/components/ui'
import { ListState } from '@/components/states'
import { authStore } from '@/store'
import * as taskService from '@/services/task'
import { cloudTaskList } from '@/services/cloud/task'
import { toLegacyTask } from '@/services/cloud/legacy-view'
import { TaskListRequestGate, type TaskListRequest } from '@/utils/task-list-request-gate'
import { ROUTES } from '@/constants'
import type { Task } from '@/types/domain'
import './me.scss'

const SEGS = [
  { key: 'active', label: '进行中', status: 'CLAIMED,REJECTED' },
  { key: 'review', label: '待验收', status: 'SUBMITTED' },
  { key: 'done', label: '已完成', status: 'APPROVED,DONE' },
]

function MyTasks() {
  const initial = Taro.getCurrentInstance().router?.params?.seg
  const [seg, setSeg] = useState(SEGS.some((s) => s.key === initial) ? (initial as string) : 'active')
  const [tasks, setTasks] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState(false)
  /** cloud：cursor 分页；云列表契约不返回 total，故用 hasMore 判据 */
  const [hasMore, setHasMore] = useState(false)
  const gate = useRef(new TaskListRequestGate())
  const pendingPage = useRef<TaskListRequest | null>(null)
  const cursors = useRef<(string | undefined)[]>([undefined])
  const uid = authStore.user?.id

  const settle = (request: TaskListRequest) => {
    if (gate.current.isCurrent(request)) {
      if (request.page === 0) setLoading(false)
      else setLoadingMore(false)
    }
    if (
      pendingPage.current?.generation === request.generation &&
      pendingPage.current.page === request.page
    ) pendingPage.current = null
  }

  /** cloud：cursor 分页 + 保留 requestGate 竞态门禁；A 队结果不回填 B。 */
  const loadCloud = async (segment: string, request: TaskListRequest) => {
    const team = authStore.cloudActiveTeam
    if (!team || authStore.cloudTeamState !== 'READY') {
      settle(request)
      return
    }
    const clubId = team.clubId
    const cur = SEGS.find((s) => s.key === segment)
    const statusList = (cur?.status || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      const res = await cloudTaskList(clubId, {
        assigneeMemberId: uid,
        status: statusList.length > 0 ? statusList : undefined,
        cursor: cursors.current[request.page],
        pageSize: 20,
      })
      if (!gate.current.commit(request)) return
      if (authStore.cloudActiveTeam?.clubId !== clubId) return
      const mapped = res.items.map(toLegacyTask)
      setTasks((prev) => (request.page === 0 ? mapped : [...prev, ...mapped]))
      setHasMore(res.hasMore)
      if (res.nextCursor) cursors.current[request.page + 1] = res.nextCursor
      setError(null)
      setMoreError(false)
    } catch {
      if (gate.current.isCurrent(request)) {
        if (request.page === 0) setError('加载任务失败')
        else setMoreError(true)
      }
    } finally {
      settle(request)
    }
  }

  const load = async (segment: string, pageRequest?: TaskListRequest) => {
    if (!uid) return
    const request = pageRequest || gate.current.beginRefresh()
    if (request.page === 0) {
      pendingPage.current = null
      cursors.current = [undefined]
    } else {
      if (pendingPage.current !== null) return
      pendingPage.current = request
    }
    setError(null)
    setMoreError(false)
    if (request.page === 0) {
      setLoading(true)
      setLoadingMore(false)
    }
    else setLoadingMore(true)

    if (authStore.isCloud) {
      await loadCloud(segment, request)
      return
    }
    try {
      const cur = SEGS.find((s) => s.key === segment)
      const res = await taskService.fetchTasks({
        assigneeId: uid,
        status: cur?.status || '',
        page: request.page,
        size: 20,
      })
      if (!gate.current.commit(request)) return
      setTasks((prev) => request.page === 0 ? res.items : [...prev, ...res.items])
      setTotal(res.total)
      setError(null)
      setMoreError(false)
    } catch {
      if (gate.current.isCurrent(request)) {
        if (request.page === 0) setError('加载任务失败')
        else setMoreError(true)
      }
    } finally {
      settle(request)
    }
  }

  const canLoadMore = authStore.isCloud ? hasMore : tasks.length < total

  useDidShow(() => {
    // cloud：未就绪时交由 PageShell 统一守卫决定落点（选队/账户页），不在此跳登录
    if (!authStore.isCloud && !authStore.isLoggedIn) {
      Taro.reLaunch({ url: ROUTES.login })
      return
    }
    if (uid) void load(seg)
  })

  usePullDownRefresh(async () => {
    try {
      await load(seg)
    } finally {
      Taro.stopPullDownRefresh()
    }
  })

  useReachBottom(() => {
    if (uid && canLoadMore && !loading && !loadingMore) {
      const request = gate.current.beginNextPage()
      if (request) void load(seg, request)
    }
  })

  return (
    <PageShell kicker='MY TASKS' headTitle='我的任务' showBack>
      <View className='pool-seg'>
        {SEGS.map((s) => (
          <View
            key={s.key}
            className={`pool-seg__item pressable ${seg === s.key ? 'pool-seg__item--on' : ''}`}
            onClick={() => {
              setSeg(s.key)
              setTasks([])
              setTotal(0)
              if (uid) void load(s.key)
            }}
          >
            <Text>{s.label}</Text>
          </View>
        ))}
      </View>

      <ListState
        loading={loading && tasks.length === 0}
        error={error}
        empty={tasks.length === 0}
        onRetry={() => load(seg)}
        emptyTitle='这个分组下还没有任务'
        emptyHint='去任务池认领一个？'
        emptyAction={
          <View
            className='btn-primary pressable'
            onClick={() => Taro.switchTab({ url: ROUTES.taskPool })}
          >
            <Text>去任务池</Text>
          </View>
        }
      >
        <View className='stack-gap stagger-item'>
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onPress={() => Taro.navigateTo({ url: `${ROUTES.taskDetail}?id=${t.id}` })}
            />
          ))}
          {loadingMore ? <Text className='pool-more'>加载中…</Text> : null}
          {moreError ? (
            <Text
              className='pool-more pool-more--retry'
              onClick={() => {
                const request = gate.current.beginNextPage()
                if (request) void load(seg, request)
              }}
            >
              加载失败，点击重试
            </Text>
          ) : null}
        </View>
      </ListState>
    </PageShell>
  )
}

export default observer(MyTasks)
