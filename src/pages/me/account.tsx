import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import PageShell from '@/components/page-shell'
import { Card } from '@/components/ui'
import { authStore } from '@/store'
import { ROUTES } from '@/constants'
import { roleLabel } from '@/utils/permission'
import './account.scss'

/**
 * 账户（多团队 DESIGN §5.1、PLAN M7）。
 *
 * - 显示当前设备所在的**本队**会话摘要（团队/姓名/职务/角色）与设备级操作；
 *   不展示内部 accountKey、不展示其他团队关系、不做跨队汇总。
 * - 云模式不提供演示人物/角色切换与数据重置（那属于 demo/http 独立能力）。
 *
 * 2026-10-18：原「获取团队开通参考号」入口已整体替换为「开通新团队」——
 * 开通改为小程序内闭环（本队成员申请 → 本队管理员/超管审批 → 建队）。
 * 参考号与受控开通仅保留在服务端，作为平台运维兜底，不再暴露给普通用户。
 */
function Account() {
  const team = authStore.cloudActiveTeam

  const rows: { label: string; value: string }[] = [
    { label: '当前团队', value: team ? `${team.clubName}（${team.displayCode}）` : '未进入团队' },
    { label: '本队姓名', value: team?.displayName || '—' },
    { label: '本队职务', value: team?.duty || '—' },
    { label: '本队角色', value: roleLabel(authStore.clubRole) },
  ]

  return (
    <PageShell kicker='ACCOUNT' headTitle='账户' showBack>
      <View className='stack-gap fade-in'>
        <Card>
          <Text className='text-card-title'>账户</Text>
          <Text className='text-caption'>同一微信可加入多个团队；各队资料与权限互相独立。</Text>
          {rows.map((row) => (
            <View key={row.label} className='account-row'>
              <Text className='text-caption'>{row.label}</Text>
              <Text className='account-row__value'>{row.value}</Text>
            </View>
          ))}
        </Card>

        <View className='btn-secondary pressable' onClick={() => Taro.navigateTo({ url: ROUTES.teamSelect })}>
          <Text>切换团队</Text>
        </View>
        <View className='btn-secondary pressable' onClick={() => Taro.navigateTo({ url: ROUTES.teamProfile })}>
          <Text>编辑本队资料</Text>
        </View>
        <View className='btn-secondary pressable' onClick={() => Taro.navigateTo({ url: ROUTES.teamJoin })}>
          <Text>加入其他团队</Text>
        </View>
        {authStore.isCloud ? (
          <View className='btn-secondary pressable' onClick={() => Taro.navigateTo({ url: ROUTES.newTeam })}>
            <Text>开通新团队</Text>
          </View>
        ) : null}
        <View
          className='btn-secondary pressable'
          onClick={() => {
            void Taro.showModal({ title: '退出登录', content: '确定退出 Rak？' }).then((result) => {
              if (result.confirm) void authStore.logout()
            })
          }}
        >
          <Text>退出登录</Text>
        </View>
      </View>
    </PageShell>
  )
}

export default observer(Account)
