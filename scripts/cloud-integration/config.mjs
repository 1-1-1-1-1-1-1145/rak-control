/**
 * test:cloud:integration 的前置配置解析（PLAN §4）。
 *
 * 纯函数、无副作用：便于单测断言"缺 env/身份/证据 ⇒ 非零退出，不 skip 成 PASS"。
 * **不得**在此打印任何凭证内容；只回显"缺失项名称"。
 */

/** 真实云集成所需的全部环境变量（缺一即 BLOCKED）。 */
export const REQUIRED_ENV = [
  /** 已核实的云环境 ID（例如 cloud1-xxxx） */
  'RAK_CLOUD_ENV',
  /** 小程序 AppID */
  'RAK_APP_ID',
  /** 真实微信身份的 callFunction 调用通道模板：
   *  形如 `tcb fn invoke {fn} -e {env} --params {params}`，由操作方按其已核实 CLI 形态提供；
   *  不允许用管理员身份代替真实微信身份。 */
  'RAK_FN_INVOKE_TEMPLATE',
  /** 独立只读断言通道模板（管理员只读，**独立于**上面的身份通道） */
  'RAK_ADMIN_READ_TEMPLATE',
  /** fixture 描述文件路径（两队 clubId、身份 openid、memberId、任务/公告/ROI ID 等） */
  'RAK_FIXTURE_FILE',
]

/** 设备类用例开关：默认关闭并按 NOT_RUN 记录（不冒充 PASS）。 */
export const DEVICE_CASES_ENV = 'RAK_ENABLE_DEVICE_CASES'

function present(env, key) {
  return String(env[key] ?? '').trim().length > 0
}

/**
 * @returns {{ ok: boolean, missing: string[], deviceCasesEnabled: boolean,
 *             config: { cloudEnv: string, appId: string, invokeTemplate: string,
 *                       adminTemplate: string, fixtureFile: string } | null }}
 */
export function resolveIntegrationConfig(env = {}) {
  const missing = REQUIRED_ENV.filter((key) => !present(env, key))
  if (missing.length > 0) {
    return { ok: false, missing, deviceCasesEnabled: false, config: null }
  }
  return {
    ok: true,
    missing: [],
    deviceCasesEnabled: String(env[DEVICE_CASES_ENV] ?? '').trim() === '1',
    config: {
      cloudEnv: String(env.RAK_CLOUD_ENV).trim(),
      appId: String(env.RAK_APP_ID).trim(),
      invokeTemplate: String(env.RAK_FN_INVOKE_TEMPLATE).trim(),
      adminTemplate: String(env.RAK_ADMIN_READ_TEMPLATE).trim(),
      fixtureFile: String(env.RAK_FIXTURE_FILE).trim(),
    },
  }
}

/** BLOCKED 说明（非零退出前打印；只含缺失项名称，不含值）。 */
export function blockedMessage(missing) {
  const lines = [
    'test:cloud:integration BLOCKED：缺少真实环境/身份/独立只读断言所需配置。',
    '按 PLAN §4，缺 env/身份/证据必须非零退出，**不得** skip 成 PASS；本次不产生任何',
    '真实云结论（M0 云能力门禁与 M8 部署均未完成）。缺失项：',
  ]
  for (const key of missing) lines.push(`  - ${key}`)
  lines.push('解锁条件（人工）：见 docs/MANUAL-OPERATIONS.md H-1 / H-4。')
  return lines.join('\n')
}

/** 把模板拆成 argv 并替换 {fn}/{env}/{params} 占位符（不猜 CLI 参数，模板由操作方提供）。 */
export function buildInvokeArgv(template, { fn, env, params }) {
  return template
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.replace('{fn}', fn).replace('{env}', env).replace('{params}', params))
}
