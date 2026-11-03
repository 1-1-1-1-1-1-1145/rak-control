import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, StatusPill } from '@/components/ui'
import { ListState } from '@/components/states'
import { teamStore } from '@/store'
import { formatDateTime } from '@/utils/format'
import { toast } from '@/utils/toast'
import { DEMO_MODE } from '@/constants'
import '../../admin.scss'

function AdminJoinRequests() {
  const [loading, setLoading] = useState(true)

  const reload = () => teamStore.loadJoinRequests().finally(() => setLoading(false))

  useDidShow(() => {
    void reload()
  })

  usePullDownRefresh(async () => {
    await reload()
    Taro.stopPullDownRefresh()
  })

  /** 驳回理由必填（服务端 join.reject 强制校验） */
  const reject = async (id: string, name: string) => {
    const r = await showModalEditable({
      title: `拒绝「${name}」的入队申请`,
      placeholderText: '驳回理由（必填，将反馈给申请人）',
    })
    if (!r.confirm) return
    const reason = (r.content || '').trim()
    if (!reason) {
      toast('驳回必须填写理由')
      return
    }
    await teamStore.rejectJoin(id, reason)
  }

  return (
    <PageShell
      kicker='REQUESTS'
      headTitle='申请审批'
      showBack
      requireRole='manage'
      headStatus={
        <StatusPill
          dot={teamStore.joinRequests.length > 0}
          text={teamStore.joinError ? '申请列表加载失败' : `待处理 ${teamStore.joinRequests.length}`}
        />
      }
    >
      {DEMO_MODE ? (
        <Card>
          <Text className='text-caption'>入队申请由 Rak 服务端接收和审批。连接后端后可查看真实申请。</Text>
        </Card>
      ) : <ListState
        loading={loading && teamStore.joinRequests.length === 0 && !teamStore.joinError}
        error={teamStore.joinError}
        empty={teamStore.joinRequests.length === 0}
        onRetry={reload}
        emptyTitle='没有待处理的申请'
        emptyHint='申请人从登录页「申请加入」提交后出现在这里'
        art='user'
      >
        <Card className='fade-in'>
          {teamStore.joinRequests.map((r) => (
            <View key={r.id} className='invite-card'>
              <View className='row-between'>
                <Text className='text-card-title'>{r.applicantName}</Text>
                <Text className='text-caption'>{formatDateTime(r.createdAt)}</Text>
              </View>
              <Text className='text-caption'>微信号：{r.applicantWechat}</Text>
              <Text className='text-body'>{r.reason}</Text>
              <View className='row-gap'>
                <View
                  className='btn-primary flex-1 pressable'
                  onClick={() => teamStore.approveJoin(r.id)}
                >
                  <Text>通过（自动建号入册）</Text>
                </View>
                <View
                  className='btn-secondary flex-1 btn-danger-text pressable'
                  onClick={() => reject(r.id, r.applicantName)}
                >
                  <Text>拒绝</Text>
                </View>
              </View>
            </View>
          ))}
        </Card>
      </ListState>}
    </PageShell>
  )
}

/** 微信 showModal 的 editable/content 是运行时能力，Taro 类型未覆盖，此处收口一次 */
function showModalEditable(opts: {
  title: string
  placeholderText?: string
}): Promise<{ confirm: boolean; content?: string }> {
  return Taro.showModal({
    ...opts,
    editable: true,
  } as Taro.showModal.Option) as unknown as Promise<{ confirm: boolean; content?: string }>
}

export default observer(AdminJoinRequests)
