import Taro from '@tarojs/taro'
import { DEMO_MODE } from '@/constants'
import { DemoAdapter } from './adapter'
import { createDemoServices } from './services'

let services: ReturnType<typeof createDemoServices> | null = null

export function getDemoServices(): ReturnType<typeof createDemoServices> {
  if (!DEMO_MODE) throw new Error('本地演示服务未在当前构建中启用')
  if (!services) {
    const adapter = new DemoAdapter({
      getItem(key) {
        const value = Taro.getStorageSync(key)
        return typeof value === 'string' ? value : null
      },
      setItem(key, value) {
        Taro.setStorageSync(key, value)
      },
      removeItem(key) {
        Taro.removeStorageSync(key)
      },
    })
    services = createDemoServices(adapter)
  }
  return services
}

export const demoServices = new Proxy({} as ReturnType<typeof createDemoServices>, {
  get(_target, key: keyof ReturnType<typeof createDemoServices>) {
    return getDemoServices()[key]
  },
})
