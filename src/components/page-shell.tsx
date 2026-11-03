import { Text, View } from '@tarojs/components'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import NavBar from '@/components/nav-bar'
import { MagHead } from '@/components/ui'
import { uiStore, authStore } from '@/store'
import { canManage, isSuper } from '@/utils/permission'
import { decideGuard } from '@/utils/team-guard'
import { consumeDeepLink } from '@/utils/deep-link-entry'
import { toast } from '@/utils/toast'
import { DEMO_MODE, ROUTES } from '@/constants'
import './page.scss'

interface PageShellProps {
  title?: string
  showBack?: boolean
  subtitle?: string
  /** 刊头三件套（bento 模式）：任一传入即启用，NavBar 标题让位 */
  kicker?: string
  headTitle?: ReactNode
  headStatus?: ReactNode
  children: ReactNode
  requireRole?: 'manage' | 'super' | null
}

/** 账户页：自行处理未识别态与"已在别的队"，不被强制重定向（否则新加入页会被旧 login 覆盖）。 */
const ACCOUNT_PAGES = new Set<string>([ROUTES.login, ROUTES.joinStatus, ROUTES.teamJoin, ROUTES.teamJoinStatus])

function redirectTarget(to: 'login' | 'select' | 'me'): string {
  if (to === 'login') return ROUTES.login
  if (to === 'select') return ROUTES.teamSelect
  return ROUTES.profile
}

function PageShell({
  title,
  showBack,
  subtitle,
  kicker,
  headTitle,
  headStatus,
  children,
  requireRole = null,
}: PageShellProps) {
  const role = authStore.clubRole
  const router = useRouter()
  const routePath = router?.path ? `/${router.path.replace(/^\//, '')}` : ''
  const isCloud = authStore.isCloud
  const isAccountPage = ACCOUNT_PAGES.has(routePath)
  const isTeamSelectionPage = routePath === ROUTES.teamSelect

  // cloud：统一守卫（先 bootstrap/enter 再 load；异队/无队拒绝进入）
  const cloudDecision = isCloud
    ? decideGuard({
        state: authStore.cloudTeamState,
        isAccountIdentified: authStore.cloudAccountIdentified,
        hasActiveTeam: !!authStore.cloudActiveTeam,
        requiresTeam: !isAccountPage && !isTeamSelectionPage,
        requiresRole: requireRole,
        role,
        isTeamSelectionPage,
        isAccountPage,
      })
    : ({ kind: 'LOAD' } as const)

  const legacyBlocked =
    !isCloud &&
    ((requireRole === 'manage' && authStore.isLoggedIn && !canManage(role)) ||
      (requireRole === 'super' && authStore.isLoggedIn && !isSuper(role)))

  useEffect(() => {
    if (isCloud) {
      if (cloudDecision.kind === 'REDIRECT') {
        void Taro.reLaunch({ url: redirectTarget(cloudDecision.to) })
        return
      }
      // 唯一深链入口之二：已挂载页携带的深链参数（模块内对同一目标去重）
      if (cloudDecision.kind === 'LOAD') {
        void consumeDeepLink(router?.params as Record<string, unknown> | undefined)
      }
      return
    }
    if (requireRole === 'manage' && authStore.isLoggedIn && !canManage(role)) {
      toast('无管理权限')
      void Taro.reLaunch({ url: ROUTES.index })
    }
    if (requireRole === 'super' && authStore.isLoggedIn && !isSuper(role)) {
      toast('仅产品负责人可见')
      void Taro.reLaunch({ url: ROUTES.index })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requireRole, role, authStore.isLoggedIn, isCloud, cloudDecision.kind, cloudDecision.kind === 'REDIRECT' ? cloudDecision.to : ''])

  const blocked = isCloud
    ? cloudDecision.kind === 'WAIT' || cloudDecision.kind === 'REDIRECT'
    : legacyBlocked

  const useMagHead = kicker !== undefined || headTitle !== undefined || headStatus !== undefined

  return (
    <View className={`page-shell theme-${uiStore.theme}`}>
      {DEMO_MODE ? (
        <View className='demo-ribbon'>
          <Text>本地演示 · 数据仅保存在当前设备</Text>
        </View>
      ) : null}
      <NavBar title={useMagHead ? '' : title} showBack={showBack} subtitle={subtitle} />
      <View className='page'>
        {blocked ? (
          <View className='empty-state'>
            <View className='text-card-title'>无访问权限</View>
            <View className='text-caption'>正在返回…</View>
          </View>
        ) : (
          <>
            {useMagHead ? (
              <MagHead kicker={kicker ?? ''} title={headTitle ?? title ?? ''} status={headStatus} />
            ) : null}
            {children}
          </>
        )}
      </View>
    </View>
  )
}

export default observer(PageShell)
