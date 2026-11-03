import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useCallback, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, RoleBadge, StatusPill } from '@/components/ui'
import { authStore, teamStore } from '@/store'
import {
  cloudApproveDismissal,
  cloudListDismissals,
  cloudRejectDismissal,
  cloudRequestDismissal,
} from '@/services/cloud/admin-ops'
import type { MemberDismissalView } from '@/services/cloud/dto'
import { createMutationId } from '@/utils/mutation-id'
import { formatDateTime } from '@/utils/format'
import { roleLabel } from '@/utils/permission'
import { toast } from '@/utils/toast'
import '../../admin.scss'

/**
 * 裁员管理（2026-10-18）。
 *
 * - 所有成员裁员都需**双人双角色**审批：一名 manager + 一名 super_admin；
 * - 两名审批人必须不同，**发起人不能审批**；
 * - 两节点齐 → 目标置 LEFT（不可通过业务接口恢复）。
 */
function AdminDismissals() {
  const [items, setItems] = useState<MemberDismissalView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    const team = authStore.cloudActiveTeam
    if (!team) return
    setLoading(true)
    try {
      const page = await cloudListDismissals(team.clubId, { status: 'PENDING' })
      setItems(page.items)
      setError(null)
    } catch (e) {
      setError((e as Error)?.message || '加载裁员申请失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    void teamStore.loadMembers()
    void reload()
  })

  usePullDownRefresh(async () => {
    await reload()
    Taro.stopPullDownRefresh()
  })

  async function start(): Promise<void> {
    const team = authStore.cloudActiveTeam
    if (!team || busy) return
    const candidates = teamStore.members.filter(
      (m) => m.status === 'ACTIVE' && m.id !== team.memberId
    )
    if (candidates.length === 0) {
      toast('没有可裁撤的成员')
      return
    }
    const pick = await Taro.showActionSheet({
      itemList: candidates.map((m) => `${m.displayName || '成员'}（${roleLabel(m.clubRole)}）`),
    }).catch(() => null)
    if (!pick) return
    const target = candidates[pick.tapIndex]

    const modal = await showModalEditable({
      title: `对「${target.displayName || '成员'}」发起裁员申请`,
      placeholderText: '裁员理由（必填，2..200 字）',
    })
    if (!modal.confirm) return
    const reason = (modal.content || '').trim()
    if (reason.length < 2) {
      toast('请填写裁员理由')
      return
    }
    setBusy(true)
    try {
      await cloudRequestDismissal(
        team.clubId,
        { targetMemberId: target.id, reason },
        createMutationId()
      )
      toast('已提交：需管理员与超级管理员分别批准')
      await reload()
    } catch (e) {
      toast((e as Error)?.message || '提交失败')
    } finally {
      setBusy(false)
    }
  }

  async function approve(item: MemberDismissalView): Promise<void> {
    const team = authStore.cloudActiveTeam
    if (!team || busyId) return
    setBusyId(item.dismissalId)
    try {
      const result = await cloudApproveDismissal(team.clubId, item.dismissalId, {
        mutationId: createMutationId(),
        expectedRevision: item.revision,
      })
      toast(result.executed ? '双审批已齐：裁员已生效' : '已记录你的批准，等待另一角色审批')
      await reload()
    } catch (e) {
      toast((e as Error)?.message || '审批失败')
    } finally {
      setBusyId(null)
    }
  }

  async function reject(item: MemberDismissalView): Promise<void> {
    const team = authStore.cloudActiveTeam
    if (!team || busyId) return
    const modal = await showModalEditable({
      title: `驳回对「${item.targetDisplayName || '成员'}」的裁员申请`,
      placeholderText: '驳回理由（必填）',
    })
    if (!modal.confirm) return
    const reason = (modal.content || '').trim()
    if (!reason) {
      toast('驳回必须填写理由')
      return
    }
    setBusyId(item.dismissalId)
    try {
      await cloudRejectDismissal(
        team.clubId,
        { dismissalId: item.dismissalId, rejectReason: reason },
        { mutationId: createMutationId(), expectedRevision: item.revision }
      )
      toast('已驳回')
      await reload()
    } catch (e) {
      toast((e as Error)?.message || '驳回失败')
    } finally {
      setBusyId(null)
    }
  }

  const myMemberId = authStore.cloudActiveTeam?.memberId ?? ''
  const isSuper = authStore.clubRole === 'super_admin'

  /** 阶段与可用性：FIRST 仅申请人本人；FINAL 仅另一位 super_admin。 */
  const stageLabel = (item: MemberDismissalView): string =>
    item.currentStage === 'FIRST'
      ? '第一阶段（申请人本人）'
      : item.currentStage === 'FINAL'
        ? '最终审批（超级管理员）'
        : '已完成'
  const canApprove = (item: MemberDismissalView): boolean => {
    if (item.currentStage === 'FIRST') return item.requestedByMemberId === myMemberId
    if (item.currentStage === 'FINAL') {
      return isSuper && item.requestedByMemberId !== myMemberId
    }
    return false
  }

  return (
    <PageShell
      kicker='DISMISSAL'
      headTitle='裁员管理'
      subtitle='首位超管自批；其余人本人第一阶段 + 另一位超管终审'
      showBack
      requireRole='manage'
      headStatus={<StatusPill dot={items.length > 0} text={error ? '加载失败' : `待审 ${items.length}`} />}
    >
      <View className='stack-gap fade-in'>
        <View
          className={`btn-primary pressable${busy ? ' btn-primary--disabled' : ''}`}
          onClick={busy ? undefined : () => void start()}
        >
          <Text>{busy ? '提交中…' : '发起裁员申请'}</Text>
        </View>

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
            <Text className='text-card-title'>没有待审的裁员申请</Text>
            <Text className='text-caption'>
              首位超管发起后本人确认即可；其他人发起后需本人确认 + 另一位超管终审。
            </Text>
          </Card>
        ) : null}

        {items.map((item) => {
          const disabled = busyId !== null || !canApprove(item)
          return (
            <Card key={item.dismissalId}>
              <View className='row-between'>
                <Text className='text-card-title'>{item.targetDisplayName || '成员'}</Text>
                <RoleBadge role={item.targetRole} />
              </View>
              <Text className='text-caption'>理由：{item.reason}</Text>
              <Text className='text-caption'>
                当前环节：{stageLabel(item)}
              </Text>
              <Text className='text-caption'>
                第一阶段：{item.firstApprovedByMemberId ? '已确认' : '待确认'} · 最终审批：
                {item.requesterIsPrimaryOwner
                  ? '无需（首位超管）'
                  : item.finalApprovedByMemberId
                    ? '已通过'
                    : '待审批'}
              </Text>
              <Text className='text-caption'>
                发起人：{item.requestedByDisplayName || '—'} · {formatDateTime(item.createdAt)}
              </Text>
              {item.currentStage === 'FIRST' && item.requestedByMemberId !== myMemberId ? (
                <Text className='text-caption'>等待申请人本人完成第一阶段确认</Text>
              ) : null}
              {item.currentStage === 'FINAL' && !canApprove(item) ? (
                <Text className='text-caption'>
                  {isSuper ? '不能由申请人完成最终审批' : '等待超级管理员完成最终审批'}
                </Text>
              ) : null}
              <View className='row-gap' style={{ marginTop: '20rpx' }}>
                <View
                  className={`btn-primary flex-1 pressable${disabled ? ' btn-primary--disabled' : ''}`}
                  onClick={disabled ? undefined : () => void approve(item)}
                >
                  <Text>
                    {busyId === item.dismissalId
                      ? '处理中…'
                      : item.currentStage === 'FIRST'
                        ? '第一阶段确认'
                        : '最终审批通过'}
                  </Text>
                </View>
                <View
                  className={`btn-secondary flex-1 btn-danger-text pressable${busyId ? ' btn-primary--disabled' : ''}`}
                  onClick={busyId ? undefined : () => void reject(item)}
                >
                  <Text>驳回</Text>
                </View>
              </View>
            </Card>
          )
        })}
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

export default observer(AdminDismissals)
