import { Input, Text, Textarea, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useCallback, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, StatusPill } from '@/components/ui'
import { authStore } from '@/store'
import { cloudMyNewTeamApplications, cloudSubmitNewTeamApplication } from '@/services/cloud/club-application'
import type { NewTeamApplicationView } from '@/services/cloud/dto'
import { formatDateTime } from '@/utils/format'
import { normalizeNewTeamForm } from '@/utils/new-team-form'
import { toast } from '@/utils/toast'
import './new-team.scss'

/**
 * 开通新团队（2026-10-18）。
 *
 * 流程闭环在小程序内：
 * 1. 本队成员填写新团队信息并提交 → 申请落到**当前团队**的审批列表；
 * 2. 本队 manager / super_admin 在「开队审批」页通过或驳回；
 * 3. 通过后服务端创建新团队，**申请人成为新团队 owner（super_admin）**；
 * 4. 本页下方常显本人全部申请与状态/驳回理由（站内反馈，无需控制台）。
 *
 * 注意：审批人看的是**本队**申请（TEAM scope），A 队管理员看不到 B 队申请。
 */
function NewTeam() {
  const team = authStore.cloudActiveTeam
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [displayCode, setDisplayCode] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [mine, setMine] = useState<NewTeamApplicationView[]>([])
  const [mineLoading, setMineLoading] = useState(false)
  const [mineError, setMineError] = useState<string | null>(null)

  const loadMine = useCallback(async (): Promise<void> => {
    setMineLoading(true)
    try {
      const page = await cloudMyNewTeamApplications()
      setMine(page.items)
      setMineError(null)
    } catch (e) {
      setMineError((e as Error)?.message || '加载申请记录失败')
    } finally {
      setMineLoading(false)
    }
  }, [])

  useDidShow(() => {
    void loadMine()
  })

  async function submit(): Promise<void> {
    if (!team) {
      toast('请先进入一个团队，再由本队管理员审批开通')
      return
    }
    const normalized = normalizeNewTeamForm({ name, slug, displayCode, description })
    if (!normalized.ok) {
      toast(normalized.message)
      return
    }
    setBusy(true)
    try {
      const result = await cloudSubmitNewTeamApplication(team.clubId, normalized.value)
      toast(result.replayed ? '该申请已在审批中，请勿重复提交' : '已提交，等待本队管理员审批')
      setName('')
      setSlug('')
      setDisplayCode('')
      setDescription('')
      await loadMine()
    } catch (e) {
      toast((e as Error)?.message || '提交失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = Boolean(team) && !busy

  return (
    <PageShell kicker='NEW TEAM' headTitle='开通新团队' subtitle='提交后由本队管理员审批' showBack>
      <View className='stack-gap fade-in'>
        <Card>
          <Text className='text-card-title'>申请说明</Text>
          <Text className='text-caption'>
            {team
              ? `申请将提交给「${team.clubName}」的管理员或超级管理员审批。通过后你将成为新团队的超级管理员（owner）。`
              : '请先进入一个团队，才能发起开通申请（需由该队管理员审批）。'}
          </Text>
        </Card>

        <Card>
          <Text className='text-card-title'>新团队信息</Text>
          <View className='field'>
            <Text className='field__label'>团队名称</Text>
            <Input
              className='new-team__input'
              value={name}
              maxlength={40}
              placeholder='例如：摄影社分社'
              onInput={(e) => setName(e.detail.value)}
            />
          </View>
          <View className='field'>
            <Text className='field__label'>团队标识（英文/数字/短横线）</Text>
            <Input
              className='new-team__input'
              value={slug}
              maxlength={32}
              placeholder='例如：photo-branch'
              onInput={(e) => setSlug(e.detail.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            />
          </View>
          <View className='field'>
            <Text className='field__label'>展示码（大写字母/数字，4..8 位）</Text>
            <Input
              className='new-team__input'
              value={displayCode}
              maxlength={8}
              placeholder='例如：PB01'
              onInput={(e) => setDisplayCode(e.detail.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </View>
          <View className='field'>
            <Text className='field__label'>
              简介<Text className='field__optional'>（可选）</Text>
            </Text>
            <Textarea
              className='new-team__textarea'
              value={description}
              maxlength={200}
              placeholder='这个团队要做什么？'
              onInput={(e) => setDescription(e.detail.value)}
            />
          </View>
          <View
            className={`btn-primary pressable${canSubmit ? '' : ' btn-primary--disabled'}`}
            onClick={canSubmit ? () => void submit() : undefined}
          >
            <Text>{busy ? '提交中…' : '提交开通申请'}</Text>
          </View>
        </Card>

        <Card>
          <View className='row-between'>
            <Text className='text-card-title'>我的申请</Text>
            {mineLoading ? <Text className='text-caption'>加载中…</Text> : null}
          </View>
          {mineError ? (
            <View className='stack-gap'>
              <Text className='text-caption'>{mineError}</Text>
              <View className='btn-secondary pressable' onClick={() => void loadMine()}>
                <Text>重试</Text>
              </View>
            </View>
          ) : mine.length === 0 ? (
            <Text className='text-caption'>还没有提交过开通申请。</Text>
          ) : (
            <View className='stack-gap'>
              {mine.map((item) => (
                <View key={item.applicationId} className='new-team__row'>
                  <View className='row-between'>
                    <Text className='text-card-title'>{item.name}</Text>
                    <StatusPill
                      dot={item.status === 'PENDING'}
                      text={
                        item.status === 'PENDING' ? '待审批' : item.status === 'APPROVED' ? '已通过' : '已驳回'
                      }
                    />
                  </View>
                  <Text className='text-caption'>
                    {item.displayCode} · 审批团队：{item.approvalClubName || item.approvalClubId}
                  </Text>
                  <Text className='text-caption'>提交于 {formatDateTime(item.createdAt)}</Text>
                  {item.status === 'REJECTED' && item.rejectReason ? (
                    <Text className='text-caption'>驳回理由：{item.rejectReason}</Text>
                  ) : null}
                  {item.status === 'APPROVED' ? (
                    <Text className='text-caption'>已为你创建该团队：请在「切换团队」中进入。</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </Card>
      </View>
    </PageShell>
  )
}

export default observer(NewTeam)
