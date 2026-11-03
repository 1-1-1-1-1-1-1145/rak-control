import { DEMO_MODE } from '@/constants'
import type { createDemoServices } from './services'

type DemoServices = ReturnType<typeof createDemoServices>

/**
 * 演示服务**懒加载**（构建期隔离）。
 *
 * `DEMO_MODE` 是 define 常量：cloud 正式构建下为 `false`，webpack 常量折叠（ConstPlugin）
 * 会把 `if (DEMO_MODE) { require('./runtime') }` 整段判为不可达，从而不登记该依赖 ——
 * **保证正式包不含演示人物/角色数据与演示服务模块**；dev/demo 构建行为不变。
 *
 * 本文件是唯一读取 `@/demo/runtime` 的入口：其它模块不得再静态 `import` 它。
 */
export function getDemoServicesLazy(): DemoServices {
  if (DEMO_MODE) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { demoServices } = require('./runtime') as typeof import('./runtime')
    return demoServices
  }
  throw new Error('本地演示服务未在当前构建中启用')
}
