import { Input, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useCallback, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, StatusPill } from '@/components/ui'
import {
  cloudDecideDissolution,
  cloudDissolveAnyClub,
  cloudListDissolutions,
  cloudSearchClubs,
} from '@/services/cloud/admin-ops'
import type { AdminClubSummary, ClubDissolutionView } from '@/services/cloud/dto'
import { createMutationId } from '@/utils/mutation-id'
import { formatDateTime } from '@/utils/format'
import { toast } from '@/utils/toast'
import '../../admin.scss'

/**
 * 团队解散（超级管理员，2026-10-18）。
 *
 * - 管理员无法执行/无法及时完成解散时提交的「协助申请」出现在这里（跨队）；
 * - 超管可批准（执行解散）或驳回；
 * - 超管也可**直接解散任意团队**（含自己不在的队）：按团队名称搜索 → 选择目标 → 二次确认。
 */
function AdminDissolutions() {
  const [items, setItems] = useState<ClubDissolutionView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [keywordInput, setKeywordInput] = useState('')
  const [candidates, setCandidates] = useState<AdminClubSummary[]>([])
  const [selectedClub, setSelectedClub] = useState<AdminClubSummary | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [reasonInput, setReasonInput] = useState('')
  const [directBusy, setDirectBusy] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const page = await cloudListDissolutions({ status: 'PENDING' })
      setItems(page.items)
      setError(null)
    } catch (e) {
      setError((e as Error)?.message || '加载协助解散申请失败')
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

  async function approve(item: ClubDissolutionView): Promise<void> {
    if (busyId) return
    const confirm = await Taro.showModal({
      title: '协助解散团队',
      content: `确认解散「${item.clubName || item.clubId}」？解散后成员将无法进入，数据保留可审计。`,
      confirmText: '解散',
      confirmColor: '#C0392B',
    })
    if (!confirm.confirm) return
    setBusyId(item.clubId)
    try {
      const result = await cloudDecideDissolution(
        { clubId: item.clubId, approve: true },
        { mutationId: createMutationId(), expectedRevision: item.revision }
      )
      toast(`已解散（涉及成员 ${result.affectedMemberCount} 人）`)
      await reload()
    } catch (e) {
      toast((e as Error)?.message || '解散失败')
    } finally {
      setBusyId(null)
    }
  }

  async function reject(item: ClubDissolutionView): Promise<void> {
    if (busyId) return
    const modal = await showModalEditable({
      title: `驳回「${item.clubName || item.clubId}」的协助解散申请`,
      placeholderText: '驳回理由（必填）',
    })
    if (!modal.confirm) return
    const reason = (modal.content || '').trim()
    if (!reason) {
      toast('驳回必须填写理由')
      return
    }
    setBusyId(item.clubId)
    try {
      await cloudDecideDissolution(
        { clubId: item.clubId, approve: false, rejectReason: reason },
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

  async function searchClubs(): Promise<void> {
    const keyword = keywordInput.trim()
    if (!keyword) {
      toast('请输入团队名称')
      return
    }
    setSearching(true)
    try {
      const page = await cloudSearchClubs(keyword)
      setCandidates(page.items)
      setHasMore(page.hasMore)
      setSearched(true)
      setSelectedClub(page.items.length === 1 ? page.items[0] : null)
      if (page.items.length === 0) toast('未找到匹配的团队')
    } catch (e) {
      toast((e as Error)?.message || '搜索团队失败')
    } finally {
      setSearching(false)
    }
  }

  async function dissolveAny(): Promise<void> {
    const reason = reasonInput.trim()
    if (!selectedClub) {
      toast('请先搜索并选择要解散的团队')
      return
    }
    if (reason.length < 2) {
      toast('请填写解散原因（≥2 字）')
      return
    }
    const confirm = await Taro.showModal({
      title: '直接解散团队',
      content: `确认解散「${selectedClub.name}」（编码 ${selectedClub.displayCode}）？此操作不可通过业务接口恢复。`,
      confirmText: '确认解散',
      confirmColor: '#C0392B',
    })
    if (!confirm.confirm) return
    setDirectBusy(true)
    try {
      const result = await cloudDissolveAnyClub(
        { clubId: selectedClub.clubId, reason },
        createMutationId()
      )
      toast(`已解散「${selectedClub.name}」（涉及成员 ${result.affectedMemberCount} 人）`)
      setKeywordInput('')
      setCandidates([])
      setHasMore(false)
      setSearched(false)
      setSelectedClub(null)
      setReasonInput('')
      await reload()
    } catch (e) {
      toast((e as Error)?.message || '解散失败')
    } finally {
      setDirectBusy(false)
    }
  }

  return (
    <PageShell
      kicker='DISSOLUTION'
      headTitle='团队解散'
      subtitle='协助申请与直接解散'
      showBack
      requireRole='super'
      headStatus={<StatusPill dot={items.length > 0} text={error ? '加载失败' : `待处理 ${items.length}`} />}
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
            <Text className='text-card-title'>没有待处理的协助解散申请</Text>
            <Text className='text-caption'>团队管理员无法执行解散时会在本页提交申请。</Text>
          </Card>
        ) : null}

        {items.map((item) => (
          <Card key={item.clubId}>
            <View className='row-between'>
              <Text className='text-card-title'>{item.clubName || item.clubId}</Text>
              <Text className='text-caption'>{formatDateTime(item.createdAt)}</Text>
            </View>
            <Text className='text-caption'>团队 ID：{item.clubId}</Text>
            <Text className='text-caption'>申请人：{item.requestedByDisplayName || '—'}</Text>
            <Text className='text-body'>原因：{item.reason}</Text>
            <View className='row-gap' style={{ marginTop: '20rpx' }}>
              <View
                className={`btn-primary flex-1 pressable${busyId ? ' btn-primary--disabled' : ''}`}
                onClick={busyId ? undefined : () => void approve(item)}
              >
                <Text>{busyId === item.clubId ? '处理中…' : '协助解散'}</Text>
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

        <Card>
          <Text className='text-card-title'>直接解散任意团队</Text>
          <Text className='text-caption'>超级管理员可跨队解散；按团队名称搜索并选择目标团队。</Text>
          <View className='row-gap' style={{ marginTop: '20rpx' }}>
            <Input
              className='admin-input flex-1'
              value={keywordInput}
              placeholder='团队名称（编码/ID 也可）'
              onInput={(e) => setKeywordInput(String(e.detail.value ?? ''))}
              onConfirm={() => void searchClubs()}
            />
            <View
              className={`btn-secondary pressable${searching ? ' btn-primary--disabled' : ''}`}
              onClick={searching ? undefined : () => void searchClubs()}
            >
              <Text>{searching ? '搜索中…' : '搜索'}</Text>
            </View>
          </View>

          {candidates.map((club) => (
            <View
              key={club.clubId}
              className={`club-option pressable${selectedClub?.clubId === club.clubId ? ' club-option--on' : ''}`}
              onClick={() => setSelectedClub(club)}
            >
              <Text className='text-body'>{club.name}</Text>
              <Text className='text-caption'>
                编码 {club.displayCode}
                {club.status === 'MAINTENANCE' ? ' · 维护中' : ''}
              </Text>
            </View>
          ))}
          {searched && candidates.length === 0 ? (
            <Text className='text-caption'>未找到匹配的团队，请检查名称后重试。</Text>
          ) : null}
          {hasMore ? (
            <Text className='text-caption'>结果较多，仅显示前 20 个，请补充名称关键字。</Text>
          ) : null}
          {selectedClub ? (
            <Text className='text-caption'>
              已选择：{selectedClub.name}（{selectedClub.displayCode}）
            </Text>
          ) : null}

          <Textarea
            className='admin-textarea'
            value={reasonInput}
            maxlength={200}
            placeholder='解散原因（≥2 字）'
            onInput={(e) => setReasonInput(String(e.detail.value ?? ''))}
          />
          <View
            className={`btn-secondary pressable btn-danger-text${directBusy || !selectedClub ? ' btn-primary--disabled' : ''}`}
            onClick={directBusy || !selectedClub ? undefined : () => void dissolveAny()}
          >
            <Text>{directBusy ? '处理中…' : '确认解散该团队'}</Text>
          </View>
        </Card>
      </View>
    </PageShell>
  )
}

function showModalEditable(opts: {
  title: string
  placeholderText?: string
}): Promise<{ confirm: boolean; content?: string }> {
  return Taro.showModal({
    ...opts,
    editable: true,
  } as Taro.showModal.Option) as unknown as Promise<{ confirm: boolean; content?: string }>
}

export default observer(AdminDissolutions)
