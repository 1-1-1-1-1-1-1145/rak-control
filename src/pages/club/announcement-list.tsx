import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { ListState } from '@/components/states'
import { authStore, teamStore } from '@/store'
import { ROUTES } from '@/constants'
import { canManage } from '@/utils/permission'
import { formatDate } from '@/utils/format'
import './club.scss'

function AnnouncementList() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const reload = async (reset = true) => {
    setLoading(reset ? true : teamStore.announcements.length === 0)
    try {
      await teamStore.loadAnnouncements(reset ? 0 : Math.ceil(teamStore.announcements.length / 20))
      setErr(null)
    } catch {
      setErr('加载公告失败')
    } finally {
      setLoading(false)
    }
  }

  useDidShow(() => {
    if (authStore.status === 'LOADING') return
    void reload(true)
  })

  usePullDownRefresh(async () => {
    await reload(true)
    Taro.stopPullDownRefresh()
  })

  useReachBottom(() => {
    // cloud：用 Store 的 hasMore 判据；legacy：用 total
    const more = authStore.isCloud ? teamStore.annHasMore : teamStore.announcements.length < teamStore.annTotal
    if (more) void reload(false)
  })

  return (
    <PageShell kicker='NOTICES' headTitle='公告' showBack>
      <View className='stack-gap'>
        {canManage(authStore.clubRole) ? (
          <View
            className='btn-primary pressable'
            onClick={() => Taro.navigateTo({ url: ROUTES.adminAnnouncements })}
          >
            <Text>发布公告</Text>
          </View>
        ) : null}
        <ListState
          loading={loading && teamStore.announcements.length === 0}
          error={err}
          empty={teamStore.announcements.length === 0}
          onRetry={() => reload(true)}
          emptyTitle='还没有公告'
          emptyHint={authStore.isManager ? '发布第一条公告' : '管理层发布后会出现在这里'}
        >
          <View className='surface-card stagger-item'>
            {teamStore.announcements.map((a) => (
              <View
                key={a.id}
                className='ann-card pressable'
                onClick={() =>
                  Taro.navigateTo({ url: `${ROUTES.announcementDetail}?id=${a.id}` })
                }
              >
                <View className='row-between'>
                  <Text className='text-card-title flex-1'>
                    {a.pinned ? '📌 ' : ''}
                    {a.title}
                  </Text>
                  {a.status === 'DRAFT' ? (
                    <View className='badge badge--warning'>
                      <Text>草稿</Text>
                    </View>
                  ) : null}
                </View>
                <Text className='text-caption'>
                  {a.authorName || ''} · {formatDate(a.publishedAt || a.createdAt)}
                </Text>
              </View>
            ))}
          </View>
        </ListState>
      </View>
    </PageShell>
  )
}

export default observer(AnnouncementList)
