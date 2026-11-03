import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { DEMO_MODE, ROUTES } from '@/constants'
import PageShell from '@/components/page-shell'
import { Card } from '@/components/ui'
import { authStore, uiStore } from '@/store'
import { toast } from '@/utils/toast'
import * as authService from '@/services/auth'
import type { ClubRole } from '@/types/domain'

const demoRoles: { role: ClubRole; label: string; name: string }[] = [
  { role: 'member', label: '成员', name: '周同学' },
  { role: 'manager', label: '管理者', name: '林老师' },
  { role: 'super_admin', label: '超级管理员', name: '陈老师' },
]

function Settings() {
  return (
    <PageShell kicker='SETTINGS' headTitle='设置' showBack>
      <Card className='stack-gap fade-in'>
        {DEMO_MODE ? (
          <View className='stack-gap'>
            <View className='list-row'>
              <Text className='text-card-title'>演示身份</Text>
              <Text className='text-caption'>切换身份以查看不同权限下的页面</Text>
            </View>
            {demoRoles.map(({ role, label, name }) => (
              <View
                key={role}
                className='list-row list-row--pressable'
                onClick={async () => {
                  if (authStore.clubRole === role) return
                  try {
                    await authService.setDemoRole(role)
                    await authStore.refreshMe()
                    toast(`已切换为${label}`, 'success')
                    await Taro.reLaunch({ url: ROUTES.index })
                  } catch (e) {
                    toast((e as Error).message || '切换演示身份失败')
                  }
                }}
              >
                <Text className='text-card-title'>{label} · {name}</Text>
                <Text className='text-caption'>
                  {authStore.clubRole === role ? '当前身份' : '切换身份'}
                </Text>
              </View>
            ))}
            <View
              className='list-row list-row--pressable'
              onClick={() => {
                Taro.showModal({ title: '恢复演示数据', content: '任务、公告与 ROI 将恢复为初始样例。' })
                  .then(async (result) => {
                    if (!result.confirm) return
                    await authService.resetDemoData()
                    await authStore.refreshMe()
                    toast('演示数据已恢复', 'success')
                    await Taro.reLaunch({ url: ROUTES.index })
                  })
                  .catch((e) => toast((e as Error).message || '恢复演示数据失败'))
              }}
            >
              <Text className='text-card-title text-destructive'>恢复演示数据</Text>
              <Text className='text-caption'>清除本机修改并恢复初始样例</Text>
            </View>
          </View>
        ) : null}
        <View
          className='list-row list-row--pressable'
          onClick={() => {
            uiStore.toggleTheme()
            toast(uiStore.theme === 'dark' ? '已切换深色' : '已切换浅色')
          }}
        >
          <Text className='text-card-title'>主题</Text>
          <Text className='text-caption'>
            {uiStore.theme === 'light' ? '浅色' : '深色'} · 点按切换
          </Text>
        </View>
        <View className='list-row'>
          <Text className='text-card-title'>关于</Text>
          <Text className='text-caption'>
            Rak · {authStore.club?.name || '团队'} · 任务与 ROI
          </Text>
        </View>
        <View className='list-row'>
          <Text className='text-card-title'>设计基准</Text>
          <Text className='text-caption'>Linear / Vercel / shadcn · Xra-space token</Text>
        </View>
        <View className='list-row list-row--pressable' onClick={() => authStore.logout()}>
          <Text className='text-card-title text-destructive'>退出登录</Text>
          <Text className='text-caption'>清除本地身份</Text>
        </View>
      </Card>
    </PageShell>
  )
}

export default observer(Settings)
