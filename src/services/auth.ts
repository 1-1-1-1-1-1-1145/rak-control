import Taro from '@tarojs/taro'
import { DEMO_MODE, WECHAT_UI_BASE } from '@/constants'
import { setToken } from '@/utils/request'
import { getDemoServicesLazy } from '@/demo/loader'
import { requestForBackend } from './backend'

import { createAuthService } from './domain-entry'

const authService = createAuthService({
  demoMode: DEMO_MODE,
  demo: () => getDemoServicesLazy().auth,
  login: () => Taro.login(),
  request: requestForBackend,
  wechatBase: WECHAT_UI_BASE,
  setToken,
})

export const {
  wxLogin,
  bind,
  submitJoinRequest,
  fetchJoinStatus,
  fetchMe,
  logout,
  setDemoRole,
  resetDemoData,
} = authService
