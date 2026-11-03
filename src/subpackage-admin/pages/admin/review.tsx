import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { TaskCard } from '@/components/ui'
import { Skeleton, EmptyView } from '@/components/states'
import { authStore } from '@/store'
import * as taskService from '@/services/task'
import { cloudTaskList } from '@/services/cloud/task'
import { toLegacyTask } from '@/services/cloud/legacy-view'
import { ROUTES } from '@/constants'
import { relTime } from '@/utils/format'
import type { Task } from '@/types/domain'
import '../../admin.scss'

function Review() {
  const [list, setList] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)

  const reload = () => {
    if (authStore.isCloud) {
      const team = authStore.cloudActiveTeam
      if (!team || authStore.cloudTeamState !== 'READY') {
        setLoading(false)
        return Promise.resolve()
      }
      const clubId = team.clubId
      return cloudTaskList(clubId, { status: ['SUBMITTED'], pageSize: 50 })
        .then((page) => {
          // 切队即丢弃：旧队的待验收列表不得回填新队
          if (authStore.cloudActiveTeam?.clubId !== clubId) return
          setList(page.items.map(toLegacyTask))
          setHasMore(page.hasMore)
        })
        .finally(() => setLoading(false))
    }
    return taskService
      .fetchTasks({ status: 'SUBMITTED', size: 50 })
      .then((p) => {
        setList(p.items)
        setHasMore(false)
      })
      .finally(() => setLoading(false))
  }

  useDidShow(() => {
    setLoading(true)
    void reload()
  })

  usePullDownRefresh(async () => {
    await reload()
    Taro.stopPullDownRefresh()
  })

  return (
    <PageShell kicker='REVIEW' headTitle='任务验收' showBack requireRole='manage'>
      {loading ? (
        <Skeleton rows={3} />
      ) : list.length === 0 ? (
        <EmptyView title='没有待验收的任务' hint='成员提交后会出现在这里' art='search' />
      ) : (
        <View className='stack-gap fade-in'>
          <Text className='text-caption'>共 {list.length} 个等待验收 · 点进去评级或通过/驳回</Text>
          {hasMore ? (
            <Text className='text-caption'>已显示前 50 条，处理后再回来查看剩余待验收</Text>
          ) : null}
          {list.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onPress={() => Taro.navigateTo({ url: `${ROUTES.taskDetail}?id=${t.id}` })}
            />
          ))}
          <Text className='text-caption' style={{ textAlign: 'center' }}>
            最近提交：{relTime(list[0]?.submittedAt)}
          </Text>
        </View>
      )}
    </PageShell>
  )
}

export default observer(Review)
