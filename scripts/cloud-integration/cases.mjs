/**
 * MT01–MT22 真实云集成用例矩阵（真源：DESIGN §MT 矩阵；PLAN §M8 要求"逐项执行真实可执行部分"）。
 *
 * `channel` 表示该用例的执行通道：
 *  - 'identity' ：以**真实微信身份**经 callFunction 执行（RAK_FN_INVOKE_TEMPLATE）
 *  - 'admin'    ：需要**独立只读**断言（RAK_ADMIN_READ_TEMPLATE）
 *  - 'device'   ：必须真机/双设备或真实文件字节（默认 NOT_RUN，非 PASS）
 *  - 'worker'   ：需要平台调度/GC 的真实后台触发
 *
 * 本文件只是**数据**：不含任何环境结论，也不允许把未执行项标成通过。
 */

export const INTEGRATION_CASES = [
  { id: 'MT01', channel: 'identity', desc: '同人 A 超管 / B 成员：本队资料与权限不同，B 管理直调被拒' },
  { id: 'MT02', channel: 'identity', desc: 'A 个人资料/角色/绩效改变：B member 与统计不变，A 目录不泄露 B 关系' },
  { id: 'MT03', channel: 'identity', desc: 'A 被禁用 / B 有效：仅 A 受限，不全局退出 B；A 的新签名与写被拒' },
  { id: 'MT04', channel: 'identity', desc: '0 队 / 1 队 / 多队 / 同名队 / 仅待审 / 列表多页：有确定入口与 displayCode' },
  { id: 'MT05', channel: 'identity', desc: 'team.enter 失败 / 双击 / 快速连续选队 / 本队维护：无旧数据闪现' },
  { id: 'MT06', channel: 'identity', desc: 'A 慢响应在 B 返回：不回填 / 不 toast / 不跳转 / 不解 B busy' },
  { id: 'MT07', channel: 'identity', desc: 'A→B→A 后最早 A 响应仍被 epoch 拒绝（不能只比 clubId）' },
  { id: 'MT08', channel: 'identity', desc: 'A create 公告后切 B：不在 B 发布；A 草稿只留 A' },
  { id: 'MT09', channel: 'identity', desc: 'A 写超时 → 切 B → 重启再查：原 scope/原键恢复；ABSENT 不算失败' },
  { id: 'MT10', channel: 'device', desc: '选文件/saveFile/PUT/confirm 进行中切队：A session 归属固定，B 不能绑定 A' },
  { id: 'MT11', channel: 'identity', desc: 'TEAM A 配 B 的 task/member/游标：统一拒绝且无越权写' },
  { id: 'MT12', channel: 'identity', desc: 'A 角色伪装 B 管理者 / event 伪造 openid：真实 B membership 才授权' },
  { id: 'MT13', channel: 'identity', desc: 'B scope 查 A command；同 mutationId 两队：结果隔离，不泄露 A' },
  { id: 'MT14', channel: 'device', desc: '同微信两设备分别 A/B 并发：目标互不被切换，无服务端 global currentClub' },
  { id: 'MT15', channel: 'identity', desc: '加入 B 时已在 A / A、B 各有申请 / 末次邀请码并发：每队独立，不自动替换 A' },
  { id: 'MT16', channel: 'device', desc: 'A 文件给 A 管理者可用、B 管理者拒绝；真实 TTL ≤ 300 秒且过期重鉴权' },
  { id: 'MT17', channel: 'worker', desc: 'worker A job 搭 B attempt / GC 竞争：归属校验拒绝，不误删 B 与 ATTACHED' },
  { id: 'MT18', channel: 'identity', desc: '每队任务/公告/ROI/绩效/搜索/摘要/名册开关：逐项核对无串队，分页不漏授权过滤' },
  { id: 'MT19', channel: 'device', desc: '清缓存/换机/换微信/换环境后返回旧页/深链：云数据恢复，旧账号缓存不复用' },
  { id: 'MT20', channel: 'identity', desc: '客户端 DB get/query/count/write/aggregate/watch 与直接存储 SDK：全部拒绝' },
  { id: 'MT21', channel: 'admin', desc: '两队受控初始化/重复执行/抢 owner：每队唯一 owner，重复无副作用' },
  { id: 'MT22', channel: 'device', desc: '恢复 A 备份、两队同名同 hash、A 额度满：B 数据/字节/owner 不变' },
]

/** 仅按身份通道自动执行；其余通道在证据中写明原因并计为 NOT_RUN（不冒充 PASS）。 */
export function partitionCases(cases = INTEGRATION_CASES, { deviceCasesEnabled }) {
  const identity = cases.filter((c) => c.channel === 'identity')
  const notRun = cases
    .filter((c) => c.channel !== 'identity')
    .map((c) => ({
      id: c.id,
      channel: c.channel,
      reason:
        c.channel === 'device'
          ? deviceCasesEnabled
            ? '需真机/双设备人工执行'
            : '未启用真机用例（默认关闭，需 RAK_ENABLE_DEVICE_CASES=1 且人工在真机执行）'
          : c.channel === 'admin'
            ? '需独立只读断言通道人工确认（本机未配置）'
            : '需平台后台/worker 真实触发人工执行',
    }))
  return { identity, notRun }
}
