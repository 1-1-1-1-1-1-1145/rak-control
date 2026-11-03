import { PropsWithChildren } from 'react'
import Taro, { useDidShow, useLaunch } from '@tarojs/taro'
import { uiStore } from '@/store'
import { ensureAppBooted } from '@/store/app-boot'
import { consumeDeepLink } from '@/utils/deep-link-entry'
import './app.scss'

/**
 * 应用级引导入口（多团队 DESIGN §M2、§9.1）。
 *
 * - `useLaunch`：**仅冷启动**触发。完成云初始化与账户 bootstrap 后再消费启动深链。
 * - `useDidShow`：**冷启动后首次显示 + 每次从后台恢复 + reLaunch 后**都会触发。
 *   它是"后台驻留再打开 / 退出登录后重进"能恢复的唯一入口（useLaunch 不会再次触发）。
 * - 两者都走 `ensureAppBooted()` 单飞：已就绪不重跑、引导中复用同一 Promise。
 * - 失败不进入样例身份；错误态由登录页重试。
 */
function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    uiStore.syncTabBarStyle()
    // 唯一深链入口之一：启动参数（异队先走同一切换，成功后才消费 intent）
    const launchQuery = Taro.getLaunchOptionsSync?.()?.query as Record<string, unknown> | undefined
    void ensureAppBooted().then(() => consumeDeepLink(launchQuery))
  })

  useDidShow(() => {
    uiStore.syncTabBarStyle()
    // 热启动恢复：仅当引导未完成（未识别 / 仍 ACCOUNT_LOADING）时才会真正发起
    void ensureAppBooted()
  })

  return children
}

export default App
