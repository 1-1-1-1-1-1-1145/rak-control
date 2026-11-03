import { View, Text, Input, Textarea, Switch } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useEffect, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card } from '@/components/ui'
import { Skeleton } from '@/components/states'
import { authStore, teamStore } from '@/store'
import { cloudDissolveClub, cloudRequestDissolution } from '@/services/cloud/admin-ops'
import { createMutationId } from '@/utils/mutation-id'
import { toast } from '@/utils/toast'
import { ApiError } from '@/utils/request'
import type { ClubInfo } from '@/types/domain'
import '../../admin.scss'

function ClubSettings() {
  const [club, setClub] = useState<ClubInfo | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dirVisible, setDirVisible] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dangerBusy, setDangerBusy] = useState(false)

  useEffect(() => {
    teamStore
      .fetchClubInfo()
      .then((c) => {
        if (!c) return
        setClub(c)
        setName(c.name)
        setDescription(c.description || '')
        try {
          const s = JSON.parse(c.settingsJson || '{}')
          setDirVisible(s.memberDirectoryVisible !== false)
        } catch {
          /* 默认 true */
        }
      })
      .catch((e) => toast(e instanceof ApiError ? e.userMessage : '加载设置失败'))
  }, [])

  const save = async () => {
    if (!club || !name.trim()) {
      toast('名称必填')
      return
    }
    setBusy(true)
    try {
      await teamStore.updateClub({
        name: name.trim(),
        description: description.trim(),
        settings: { memberDirectoryVisible: dirVisible },
      })
      toast('已保存', 'success')
      void authStore.refreshMe()
    } catch (e) {
      toast(e instanceof ApiError ? e.userMessage : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  /** 直接解散本团队（manager / super_admin）：解散后清本机会话并回到选队。 */
  const dissolveNow = async () => {
    const clubId = authStore.cloudActiveTeam?.clubId
    if (!clubId || dangerBusy) return
    const modal = await showModalEditable({
      title: '解散团队',
      placeholderText: '解散原因（必填，≥2 字）',
    })
    if (!modal.confirm) return
    const reason = (modal.content || '').trim()
    if (reason.length < 2) {
      toast('请填写解散原因')
      return
    }
    const confirm = await Taro.showModal({
      title: '确认解散',
      content: `解散「${club?.name || clubId}」后成员将无法进入；数据保留可审计。`,
      confirmText: '确认解散',
      confirmColor: '#C0392B',
    })
    if (!confirm.confirm) return
    setDangerBusy(true)
    try {
      const result = await cloudDissolveClub(clubId, { reason }, createMutationId())
      await Taro.showModal({
        title: '已解散',
        content: `团队已解散（涉及成员 ${result.affectedMemberCount} 人）。将返回团队选择。`,
        showCancel: false,
      })
      await authStore.logout()
    } catch (e) {
      toast(e instanceof ApiError ? e.userMessage : '解散失败')
    } finally {
      setDangerBusy(false)
    }
  }

  /** 无法执行/无法及时解散时，提交协助申请给超级管理员。 */
  const requestHelp = async () => {
    const clubId = authStore.cloudActiveTeam?.clubId
    if (!clubId || dangerBusy) return
    const modal = await showModalEditable({
      title: '申请超级管理员协助解散',
      placeholderText: '申请原因（必填，≥2 字）',
    })
    if (!modal.confirm) return
    const reason = (modal.content || '').trim()
    if (reason.length < 2) {
      toast('请填写申请原因')
      return
    }
    setDangerBusy(true)
    try {
      await cloudRequestDissolution(clubId, { reason }, createMutationId())
      toast('已提交，等待超级管理员处理')
    } catch (e) {
      toast(e instanceof ApiError ? e.userMessage : '提交失败')
    } finally {
      setDangerBusy(false)
    }
  }

  if (!club) {
    return (
      <PageShell kicker='CLUB SETTINGS' headTitle='团队设置' showBack requireRole='manage'>
        <Skeleton rows={2} />
      </PageShell>
    )
  }

  return (
    <PageShell kicker='CLUB SETTINGS' headTitle='团队设置' showBack requireRole='manage'>
      <View className='stack-gap'>
        <Card className='fade-in'>
          <View className='admin-form'>
            <View className='admin-field'>
              <Text className='admin-field__label'>团队名称</Text>
              <Input
                className='admin-input'
                value={name}
                maxlength={32}
                onInput={(e) => setName(e.detail.value)}
              />
            </View>
            <View className='admin-field'>
              <Text className='admin-field__label'>简介</Text>
              <Textarea
                className='admin-textarea'
                style={{ minHeight: '140rpx' }}
                value={description}
                maxlength={200}
                onInput={(e) => setDescription(e.detail.value)}
              />
            </View>
            <View className='row-between'>
              <View>
                <Text className='admin-field__label'>成员目录对全员可见</Text>
                <Text className='text-caption'>关闭后仅管理层可见成员列表</Text>
              </View>
              <Switch checked={dirVisible} onChange={(e) => setDirVisible(!!e.detail.value)} />
            </View>
            <View
              className={`btn-primary pressable ${busy ? 'btn-primary--disabled' : ''}`}
              onClick={busy ? undefined : save}
            >
              <Text>{busy ? '保存中…' : '保存设置'}</Text>
            </View>
          </View>
        </Card>

        <Card>
          <Text className='text-card-title'>危险操作</Text>
          <Text className='text-caption'>
            解散后成员无法进入该团队；成员与业务数据保留在库中，仅平台运维可审计。
          </Text>
          <View
            className={`btn-secondary pressable btn-danger-text${dangerBusy ? ' btn-primary--disabled' : ''}`}
            onClick={dangerBusy ? undefined : () => void dissolveNow()}
          >
            <Text>{dangerBusy ? '处理中…' : '直接解散本团队'}</Text>
          </View>
          <View
            className={`btn-secondary pressable${dangerBusy ? ' btn-primary--disabled' : ''}`}
            onClick={dangerBusy ? undefined : () => void requestHelp()}
          >
            <Text>申请超级管理员协助解散</Text>
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

export default observer(ClubSettings)
