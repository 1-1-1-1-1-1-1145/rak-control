import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useCallback, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, StatusPill } from '@/components/ui'
import { authStore } from '@/store'
import {
  cloudApproveNewTeamApplication,
  cloudListNewTeamApplications,
  cloudRejectNewTeamApplication,
} from '@/services/cloud/club-application'
import type { NewTeamApplicationView } from '@/services/cloud/dto'
import { createMutationId } from '@/utils/mutation-id'
import { formatDateTime } from '@/utils/format'
import { toast } from '@/utils/toast'
import './new-team-applications.scss'

/**
 * 开队审批（本队 manager / super_admin，2026-10-18）。
 *
 * - 只列**本队**成员的待审申请（TEAM scope），异队申请看不到也批不了（服务端二次校验）；
 * - 通过 → 服务端创建新团队，申请人成为新团队 owner；驳回 → 理由必填并反馈给申请人；
 * - 用 `expectedRevision` 防并发（同一申请被两人同时处理时后到者收到"数据已变化"）。
 */
function NewTeamApplications() {
  const [items, setItems] = useState<NewTeamApplicationView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const team = authStore.cloudActiveTeam
    if (!team) return
    setLoading(true)
    try {
      const page = await cloudListNewTeamApplications(team.clubId, { status: 'PENDING' })
      setItems(page.items)
      setError(null)
    } catch (e) {
      setError((e as Error)?.message || '加载待审申请失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    void reload()
  })

  usePullDownRefresh(async () => {
    await reload()
    Taro.stopPullDownRefresh()
  })

  async function approve(item: NewTeamApplicationView): Promise<void> {
    const team = authStore.cloudActiveTeam
    if (!team || busyId) return
    setBusyId(item.applicationId)
    try {
      const result = await cloudApproveNewTeamApplication(team.clubId, item.applicationId, {
        mutationId: createMutationId(),
        expectedRevision: item.revision,
      })
      toast(result.newClubId ? '已通过：新团队已创建' : '已通过')
      await reload()
    } catch (e) {
      toast((e as Error)?.message || '审批失败，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  async function reject(item: NewTeamApplicationView): Promise<void> {
    const team = authStore.cloudActiveTeam
    if (!team || busyId) return
    const modal = await showModalEditable({
      title: `驳回「${item.name}」的开通申请`,
      placeholderText: '驳回理由（必填，将反馈给申请人）',
    })
    if (!modal.confirm) return
    const reason = (modal.content || '').trim()
    if (!reason) {
      toast('驳回必须填写理由')
      return
    }
    setBusyId(item.applicationId)
    try {
      await cloudRejectNewTeamApplication(
        team.clubId,
        { applicationId: item.applicationId, rejectReason: reason },
        { mutationId: createMutationId(), expectedRevision: item.revision }
      )
      toast('已驳回')
      await reload()
    } catch (e) {
      toast((e as Error)?.message || '驳回失败，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <PageShell
      kicker='NEW TEAMS'
      headTitle='开队审批'
      subtitle='本队成员发起的开通申请'
      showBack
      requireRole='manage'
      headStatus={
        <StatusPill dot={items.length > 0} text={error ? '加载失败' : `待审 ${items.length}`} />
      }
    >
      <View className='stack-gap fade-in'>
        {error ? (
          <Card>
            <Text className='text-card-title'>加载失败</Text>
            <Text className='text-caption'>{error}</Text>
            <View className='btn-secondary pressable' onClick={() => void reload()}>
              <Text>重试</Text>
            </View>
          </Card>
        ) : null}

        {!error && !loading && items.length === 0 ? (
          <Card>
            <Text className='text-card-title'>没有待审批的开通申请</Text>
            <Text className='text-caption'>本队成员在「开通新团队」提交后会出现在这里。</Text>
          </Card>
        ) : null}

        {items.map((item) => (
          <Card key={item.applicationId}>
            <View className='row-between'>
              <Text className='text-card-title'>{item.name}</Text>
              <Text className='text-caption'>{formatDateTime(item.createdAt)}</Text>
            </View>
            <Text className='text-caption'>
              标识 {item.slug} · 展示码 {item.displayCode}
            </Text>
            <Text className='text-caption'>申请人：{item.applicantDisplayName}</Text>
            {item.description ? <Text className='text-body'>{item.description}</Text> : null}
            <View className='row-gap new-team-applications__actions'>
              <View
                className={`btn-primary flex-1 pressable${busyId ? ' btn-primary--disabled' : ''}`}
                onClick={busyId ? undefined : () => void approve(item)}
              >
                <Text>{busyId === item.applicationId ? '处理中…' : '通过并建队'}</Text>
              </View>
              <View
                className={`btn-secondary flex-1 btn-danger-text pressable${busyId ? ' btn-primary--disabled' : ''}`}
                onClick={busyId ? undefined : () => void reject(item)}
              >
                <Text>驳回</Text>
              </View>
            </View>
          </Card>
        ))}
      </View>
    </PageShell>
  )
}

/** 微信 showModal 的 editable/content 是运行时能力，Taro 类型未覆盖，此处收口一次。 */
function showModalEditable(opts: {
  title: string
  placeholderText?: string
}): Promise<{ confirm: boolean; content?: string }> {
  return Taro.showModal({
    ...opts,
    editable: true,
  } as Taro.showModal.Option) as unknown as Promise<{ confirm: boolean; content?: string }>
}

export default observer(NewTeamApplications)
