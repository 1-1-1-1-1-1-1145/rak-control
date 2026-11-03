import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, RoleBadge } from '@/components/ui'
import { authStore, setUnsavedProbe } from '@/store'
import { ROUTES } from '@/constants'
import { toast } from '@/utils/toast'
import './team-profile.scss'

/**
 * 本队资料（多团队 DESIGN §5.1、PLAN M7）。
 *
 * - 姓名/职务属于**本队 membership**：A 队改资料不影响 B 队。
 * - 职务只是本队展示性资料、不参与授权：**任何成员都可改自己的职务**（2026-10-18 解除仅 owner 限制）。
 * - 页面登记"未提交编辑"探针：切队时由协调器要求确认。
 */
function TeamProfile() {
  const team = authStore.cloudActiveTeam
  const [displayName, setDisplayName] = useState('')
  const [duty, setDuty] = useState('')
  const [busy, setBusy] = useState(false)
  const dirtyRef = useRef(false)

  const originalName = team?.displayName ?? ''
  const originalDuty = team?.duty ?? ''

  dirtyRef.current = displayName.trim() !== originalName || duty.trim() !== originalDuty

  useEffect(() => {
    setUnsavedProbe(() => dirtyRef.current)
    return () => setUnsavedProbe(null)
  }, [])

  useDidShow(() => {
    const current = authStore.cloudActiveTeam
    setDisplayName(current?.displayName ?? '')
    setDuty(current?.duty ?? '')
  })

  async function save() {
    if (!authStore.isCloud) return
    if (!displayName.trim()) {
      await Taro.showToast({ title: '姓名不能为空', icon: 'none' })
      return
    }
    setBusy(true)
    try {
      const input: { displayName: string; duty?: string | null } = {
        displayName: displayName.trim(),
        duty: duty.trim() || null,
      }
      await authStore.updateMyProfile(input)
      dirtyRef.current = false
      toast('已保存', 'success')
    } catch (e) {
      await Taro.showToast({ title: (e as Error)?.message || '保存失败，请稍后重试', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell kicker='PROFILE' headTitle='本队资料' headStatus={<RoleBadge role={authStore.clubRole} />} showBack>
      <View className='stack-gap fade-in'>
        <Card>
          <Text className='text-card-title'>{team?.clubName ?? '未进入团队'}</Text>
          <Text className='text-caption'>
            {team ? `团队代码 ${team.displayCode}` : ''}
          </Text>
          <Text className='text-caption'>此处资料只属于当前团队，切换到其他团队不会同步。</Text>
        </Card>

        {authStore.isCloud ? (
          <Card>
            <Text className='text-card-title'>姓名与职务</Text>
            <Input
              className='team-profile__input'
              value={displayName}
              placeholder='在本队显示的姓名'
              onInput={(e) => {
                setDisplayName(String(e.detail.value ?? ''))
                dirtyRef.current = true
              }}
            />
            <Input
              className='team-profile__input'
              value={duty}
              placeholder='职务（可选）'
              onInput={(e) => {
                setDuty(String(e.detail.value ?? ''))
                dirtyRef.current = true
              }}
            />
            <View className='btn-secondary pressable' onClick={() => void save()}>
              <Text>{busy ? '保存中…' : '保存'}</Text>
            </View>
          </Card>
        ) : (
          <Card>
            <Text className='text-card-title'>当前构建不支持多团队</Text>
            <Text className='text-caption'>本队资料仅在云端正式包提供。</Text>
          </Card>
        )}

        <View className='btn-secondary pressable' onClick={() => Taro.navigateTo({ url: ROUTES.account })}>
          <Text>账户与退出</Text>
        </View>
      </View>
    </PageShell>
  )
}

export default observer(TeamProfile)
