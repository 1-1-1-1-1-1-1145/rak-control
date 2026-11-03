import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, RoleBadge, StatusPill } from '@/components/ui'
import { Skeleton, EmptyView } from '@/components/states'
import { authStore, teamStore } from '@/store'
import { toast } from '@/utils/toast'
import type { ClubMember, ClubRole } from '@/types/domain'
import '../../admin.scss'

/** 仅 super_admin：manager / member 任免（服务端 403 兜底，见 API.md §7.5） */
function SuperRoles() {
  const [loading, setLoading] = useState(true)

  useDidShow(() => {
    Promise.all([teamStore.loadMembers(), teamStore.loadPerformance()]).finally(() =>
      setLoading(false)
    )
  })

  const change = async (m: ClubMember) => {
    const options: { label: string; role: ClubRole }[] =
      m.clubRole === 'super_admin'
        ? [{ label: '取消超级管理员（降为管理层）', role: 'manager' }]
        : m.clubRole === 'manager'
          ? [
              { label: '降为成员', role: 'member' },
              { label: '任命为超级管理员', role: 'super_admin' },
            ]
          : [
              { label: '任命为管理层', role: 'manager' },
              { label: '任命为超级管理员', role: 'super_admin' },
            ]
    const pick = await Taro.showActionSheet({ itemList: options.map((o) => o.label) }).catch(() => null)
    if (!pick) return
    const target = options[pick.tapIndex]
    try {
      await teamStore.setRole(m.userId, target.role)
      toast(
        target.role === 'super_admin'
          ? '已任命为超级管理员'
          : target.role === 'manager'
            ? '已任命管理层'
            : '已降为成员',
        'success'
      )
    } catch {
      /* store 已提示 */
    }
  }

  if (loading) {
    return (
      <PageShell kicker='ACCESS' headTitle='角色任免' showBack requireRole='super'>
        <Skeleton rows={4} />
      </PageShell>
    )
  }

  const roster = teamStore.members.filter(
    (m) => m.status === 'ACTIVE' && m.id !== authStore.cloudActiveTeam?.memberId
  )

  return (
    <PageShell
      kicker='ACCESS'
      headTitle='角色任免'
      showBack
      requireRole='super'
      headStatus={<StatusPill text='仅超级管理员' />}
    >
      {roster.length === 0 ? (
        <EmptyView title='没有可任免的成员' hint='超级管理员自身不出现在任免名单' />
      ) : (
        <Card className='fade-in'>
          {roster.map((m) => (
            <View key={m.id} className='member-row'>
              <View className='avatar-dot'>
                <Text>{(m.displayName || '成').slice(0, 1)}</Text>
              </View>
              <View className='flex-1'>
                <View className='row-gap'>
                  <Text className='text-card-title'>{m.displayName || '成员'}</Text>
                  <RoleBadge role={m.clubRole} />
                </View>
                <Text className='text-caption'>{m.duty || '成员'}</Text>
              </View>
              <Text className='text-caption text-brand' onClick={() => change(m)}>
                {m.clubRole === 'super_admin' ? '免职' : m.clubRole === 'manager' ? '撤销' : '任命'}
              </Text>
            </View>
          ))}
          {authStore.isSuper ? (
            <Text className='text-caption' style={{ display: 'block', marginTop: '16rpx' }}>
              仅首位超级管理员可任免；首位超管自身不可被撤销。普通超级管理员无法任免他人。
            </Text>
          ) : null}
        </Card>
      )}
    </PageShell>
  )
}

export default observer(SuperRoles)
