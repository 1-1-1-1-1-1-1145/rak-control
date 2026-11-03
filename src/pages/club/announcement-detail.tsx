import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Skeleton } from '@/components/states'
import { authStore } from '@/store'
import * as clubService from '@/services/club'
import { cloudAnnouncementGet } from '@/services/cloud/club'
import { toLegacyAnnouncement } from '@/services/cloud/legacy-view'
import { toast } from '@/utils/toast'
import { ApiError } from '@/utils/request'
import { formatDateTime } from '@/utils/format'
import type { Announcement } from '@/types/domain'
import './club.scss'

function AnnouncementDetail() {
  const [item, setItem] = useState<Announcement | null>(null)
  const [loading, setLoading] = useState(true)
  const id = Taro.getCurrentInstance().router?.params?.id || ''
  /** 本页异步回调 ctx 栅栏：切队后的迟到结果不得写入 */
  const loadGeneration = useRef(0)

  useEffect(() => {
    const generation = ++loadGeneration.current
    const load = async () => {
      if (authStore.isCloud) {
        const team = authStore.cloudActiveTeam
        if (!team || authStore.cloudTeamState !== 'READY') return
        const clubId = team.clubId
        const view = await cloudAnnouncementGet(clubId, id)
        if (generation !== loadGeneration.current) return
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        setItem(toLegacyAnnouncement(view))
        return
      }
      const legacy = await clubService.fetchAnnouncement(id)
      if (generation !== loadGeneration.current) return
      setItem(legacy)
    }
    load()
      .catch((e) => {
        if (generation !== loadGeneration.current) return
        toast(e instanceof ApiError ? e.userMessage : '公告不存在')
        setTimeout(() => Taro.navigateBack(), 800)
      })
      .finally(() => {
        if (generation === loadGeneration.current) setLoading(false)
      })
  }, [id])

  return (
    <PageShell kicker='NOTICE' headTitle='公告详情' showBack>
      {loading ? (
        <Skeleton rows={2} />
      ) : item ? (
        <View className='surface-card fade-in'>
          <Text className='text-title'>
            {item.pinned ? '📌 ' : ''}
            {item.title}
          </Text>
          <Text className='text-caption' style={{ marginTop: '12rpx', display: 'block' }}>
            {item.authorName || ''} · {formatDateTime(item.publishedAt || item.createdAt)}
          </Text>
          <View className='hairline' style={{ margin: '24rpx 0' }} />
          <Text className='text-body ann-body'>{item.body}</Text>
        </View>
      ) : null}
    </PageShell>
  )
}

export default observer(AnnouncementDetail)
