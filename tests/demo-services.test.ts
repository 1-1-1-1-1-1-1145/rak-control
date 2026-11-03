import assert from 'node:assert/strict'
import test from 'node:test'
import { DemoAdapter, MemoryDemoStorage } from '../src/demo/adapter.ts'
import { createDemoServices } from '../src/demo/services.ts'
import {
  createAnnouncementService,
  createAuthService,
  createRoiService,
  createTaskService,
} from '../src/services/domain-entry.ts'

function createServices() {
  const storage = new MemoryDemoStorage()
  const adapter = new DemoAdapter(storage)
  const demo = createDemoServices(adapter)
  const context = {
    demoMode: true,
    request: async () => {
      throw new Error('演示服务不得发起网络请求')
    },
    clubBase: () => '/api/v1/clubs/demo-club',
    query: () => '',
  }
  const auth = createAuthService({
    ...context,
    demo: () => demo.auth,
    login: async () => ({ code: 'not-used-in-demo' }),
    wechatBase: '/api/ui/wechat/miniprogram',
    setToken: () => undefined,
  })
  return {
    adapter,
    services: {
      auth,
      task: createTaskService({ ...context, demo: () => demo.task }),
      club: { ...demo.club, ...createAnnouncementService({ ...context, demo: () => demo.club }) },
      roi: createRoiService({ ...context, demo: () => demo.roi }),
      member: demo.member,
    },
  }
}

test('task service supports publish, claim, submit, review and preserves DTO transitions', async () => {
  const { services } = createServices()
  await services.auth.wxLogin()

  const task = await services.task.publishTask({
    title: '测试社团任务',
    description: '完成演示流程',
    category: 'ops',
  })
  assert.equal(task.status, 'OPEN')
  assert.ok((await services.task.fetchTasks({ status: 'OPEN', keyword: task.title })).items.some((item) => item.id === task.id))

  await services.auth.setDemoRole('member')
  const claimed = await services.task.claimTask(task.id)
  assert.equal(claimed.status, 'CLAIMED')
  assert.equal(claimed.assigneeId, 'demo-member')
  assert.ok((await services.task.fetchTasks({ status: 'CLAIMED', assigneeId: 'demo-member' })).items.some((item) => item.id === task.id))

  const attachments = [{
    id: 'attachment-demo-1',
    name: '活动素材.7z',
    size: 2048,
    localPath: 'wxfile://demo/活动素材.7z',
  }]
  const submitted = await services.task.submitTask(task.id, '已完成演示交付', attachments)
  assert.equal(submitted.status, 'SUBMITTED')
  assert.equal(submitted.submitNote, '已完成演示交付')
  assert.deepEqual(submitted.submissionAttachments, attachments)
  assert.ok((await services.task.fetchTasks({ status: 'SUBMITTED' })).items.some((item) => item.id === task.id))

  await services.auth.setDemoRole('manager')
  assert.deepEqual((await services.task.fetchTask(task.id)).submissionAttachments, attachments)
  const approved = await services.task.approveTask(task.id, 'A', '交付完整')
  assert.equal(approved.status, 'APPROVED')
  assert.equal(approved.qualityGrade, 'A')
  assert.ok((await services.task.fetchTasks({ status: 'APPROVED' })).items.some((item) => item.id === task.id))
})

test('task service supports reject, resubmit, approval and archive', async () => {
  const { services } = createServices()
  await services.auth.wxLogin()
  const task = await services.task.publishTask({
    title: '完整验收流程',
    description: '覆盖驳回后重新提交和归档',
    category: 'ops',
  })

  await services.auth.setDemoRole('member')
  await services.task.claimTask(task.id)
  const firstAttachment = {
    id: 'first-delivery',
    name: '初稿.unknown-format',
    size: 1024,
    localPath: 'wxfile://demo/first-delivery',
  }
  await services.task.submitTask(task.id, '第一次交付', [firstAttachment])
  await services.auth.setDemoRole('manager')
  const rejected = await services.task.rejectTask(task.id, '请补充现场照片')
  assert.equal(rejected.status, 'REJECTED')

  await services.auth.setDemoRole('member')
  const replacementAttachment = {
    id: 'replacement-delivery',
    name: '补充材料.zip',
    size: 4096,
    localPath: 'wxfile://demo/replacement-delivery',
  }
  const resubmitted = await services.task.submitTask(task.id, '已补充照片后重新提交', [replacementAttachment])
  assert.equal(resubmitted.status, 'SUBMITTED')
  assert.deepEqual(resubmitted.submissionAttachments, [replacementAttachment])

  await services.auth.setDemoRole('manager')
  await services.task.approveTask(task.id, 'B', '材料已补全')
  const archived = await services.task.archiveTask(task.id)
  assert.equal(archived.status, 'DONE')
  assert.equal(archived.rejectReason, '请补充现场照片')
})

test('task service rejects too many, empty, or oversized attachments without changing task state', async () => {
  const { services } = createServices()
  await services.auth.wxLogin()
  const task = await services.task.publishTask({
    title: '附件边界校验',
    description: '验证附件限制',
    category: 'ops',
  })
  await services.auth.setDemoRole('member')
  await services.task.claimTask(task.id)

  const attachment = (id: string, size: number) => ({
    id,
    name: `${id}.unrestricted`,
    size,
    localPath: `wxfile://demo/${id}`,
  })

  await assert.rejects(
    services.task.submitTask(task.id, '交付说明', [
      attachment('one', 1),
      attachment('two', 1),
      attachment('three', 1),
      attachment('four', 1),
    ]),
    /最多添加 3 个附件/
  )
  await assert.rejects(
    services.task.submitTask(task.id, '交付说明', [attachment('empty', 0)]),
    /文件为空/
  )
  await assert.rejects(
    services.task.submitTask(task.id, '交付说明', [attachment('large', 10 * 1024 * 1024 + 1)]),
    /单个附件不能超过 10 MB/
  )

  const unchanged = await services.task.fetchTask(task.id)
  assert.equal(unchanged.status, 'CLAIMED')
  assert.equal(unchanged.submissionAttachments, undefined)
})

test('announcement service publishes a draft and makes it visible in the list', async () => {
  const { services } = createServices()
  await services.auth.wxLogin()

  const draft = await services.club.createAnnouncement({
    title: '测试公告',
    body: '社团公告演示内容',
    pinned: false,
  })
  assert.equal(draft.status, 'DRAFT')

  const published = await services.club.publishAnnouncement(draft.id)
  assert.equal(published.status, 'PUBLISHED')
  const list = await services.club.fetchAnnouncements(0, 20)
  assert.ok(list.items.some((item) => item.id === draft.id))
})

test('ROI service aggregates income and expenses and reset restores the original seed', async () => {
  const { adapter, services } = createServices()
  await services.auth.wxLogin()
  const initialOverview = await services.roi.fetchRoiOverview('month')

  const created = await services.roi.createRoiItem({
    title: '测试活动',
    category: 'activity',
    cost: 100,
    revenue: 250,
    participants: 12,
    periodStart: new Date().toISOString().slice(0, 10),
    status: 'DONE',
  })
  assert.equal(created.roiRatio, 1.5)

  const overview = await services.roi.fetchRoiOverview('month')
  assert.equal(overview.totalCost, initialOverview.totalCost + 100)
  assert.equal(overview.totalRevenue, initialOverview.totalRevenue + 250)

  await services.task.publishTask({ title: '新增任务', description: '将被重置', category: 'ops' })
  const beforeResetCount = (await services.task.fetchTasks({ size: 100 })).total
  await services.auth.resetDemoData()
  const afterReset = await services.task.fetchTasks({ size: 100 })
  assert.equal(afterReset.total, 6)
  assert.equal(afterReset.total < beforeResetCount, true)
  assert.deepEqual(await services.roi.fetchRoiOverview('month'), initialOverview)
  assert.equal(adapter.currentRole, 'manager')
})

test('guide demo starts with task, member, announcement and ROI samples', async () => {
  const { services } = createServices()
  await services.auth.wxLogin()

  assert.ok((await services.task.fetchTasks({ status: 'OPEN', size: 20 })).total > 0)
  assert.ok((await services.member.fetchMembers()).length > 0)
  assert.ok((await services.club.fetchAnnouncements(0, 20)).items.some((item) => item.status === 'PUBLISHED'))
  const roi = await services.roi.fetchRoiOverview('month')
  assert.ok(roi.itemCount > 0)
})

test('demo storage restores edits across adapter instances', async () => {
  const storage = new MemoryDemoStorage()
  const first = createDemoServices(new DemoAdapter(storage))
  await first.auth.wxLogin()
  const task = await first.task.publishTask({ title: '持续化任务', description: '保存后可读取', category: 'ops' })

  const restored = createDemoServices(new DemoAdapter(storage))
  assert.equal((await restored.task.fetchTask(task.id)).title, '持续化任务')
})

test('demo identity switching changes effective permissions and member actions stay restricted', async () => {
  const { services } = createServices()
  await services.auth.wxLogin()

  const manager = await services.auth.fetchMe()
  assert.ok(manager.permissions.includes('task:publish'))

  await services.auth.setDemoRole('member')
  const member = await services.auth.fetchMe()
  assert.ok(!member.permissions.includes('task:publish'))
  await assert.rejects(
    services.task.publishTask({ title: '越权任务', description: '不应发布', category: 'ops' }),
    /没有管理权限/
  )

  await services.auth.setDemoRole('super_admin')
  const superAdmin = await services.auth.fetchMe()
  assert.ok(superAdmin.permissions.includes('member:write'))
})

test('demo authentication does not pretend to bind invitations or submit join requests', async () => {
  const { services } = createServices()

  await assert.rejects(services.auth.bind('ABC1234'), /需要连接 Rak 服务端/)
  await assert.rejects(
    services.auth.submitJoinRequest({ name: '周同学', wechat: 'zhou', reason: '想加入' }),
    /需要连接 Rak 服务端/
  )
})

test('auth service rejects malformed login outcomes and clears tokens for unbound login or bind', async () => {
  let response: unknown = { bound: false }
  const tokens: string[] = []
  const context = {
    demoMode: false,
    request: async () => response,
    demo: () => createDemoServices(new DemoAdapter(new MemoryDemoStorage())).auth,
    login: async () => ({ code: 'wx-code' }),
    wechatBase: '/api/ui/wechat/miniprogram',
    setToken: (token: string) => tokens.push(token),
  }
  const auth = createAuthService(context)

  await auth.wxLogin()
  await auth.bind('INVITE')
  assert.deepEqual(tokens, ['', ''])

  context.setToken('stale-token')
  response = { access_token: 'token-without-bound-flag' }
  await assert.rejects(auth.wxLogin(), /bound/)
  assert.equal(tokens.at(-1), '')

  context.setToken('stale-token')
  await assert.rejects(auth.bind('INVITE'), /bound/)
  assert.equal(tokens.at(-1), '')

  context.setToken('stale-token')
  response = { bound: 'false' }
  await assert.rejects(auth.wxLogin(), /bound/)
  assert.equal(tokens.at(-1), '')

  context.setToken('stale-token')
  response = {
    bound: true,
    access_token: 'disabled-user-token',
    user: { id: 'disabled-user', status: 'DISABLED' },
    club: { id: 'server-club', role: 'manager' },
  }
  await assert.rejects(auth.wxLogin(), /停用或身份状态无效/)
  assert.equal(tokens.at(-1), '')

  context.setToken('stale-token')
  response = {
    user: { id: 'disabled-user', status: 'DISABLED' },
    club: { id: 'server-club' },
    clubRole: 'manager',
    permissions: ['task:publish'],
  }
  await assert.rejects(auth.fetchMe(), /停用或身份状态无效/)
  assert.equal(tokens.at(-1), '')

  context.setToken('stale-token')
  response = {
    user: { id: 'server-user', status: 'ACTIVE' },
    club: { id: 'server-club' },
    clubRole: 'manager',
  }
  await assert.rejects(auth.fetchMe(), /权限信息/)
  assert.equal(tokens.at(-1), '')

  response = {
    bound: true,
    access_token: 'valid-token',
    user: { id: 'server-user', status: 'ACTIVE' },
    club: { id: 'server-club', role: 'unknown-admin-role' },
  }
  const unknownRoleOutcome = await auth.wxLogin()
  assert.equal(unknownRoleOutcome.club?.clubRole, 'member')
})

test('domain service entries use the Rak API routes when demo mode is disabled', async () => {
  const calls: { url: string; method?: string; data?: Record<string, unknown>; auth?: boolean }[] = []
  const context = {
    demoMode: false,
    demo: () => createDemoServices(new DemoAdapter(new MemoryDemoStorage())),
    request: async (options: { url: string; method?: string; data?: Record<string, unknown>; auth?: boolean }) => {
      calls.push(options)
      return (options.url.endsWith('/login') || options.url.endsWith('/bind')
        ? {
            bound: true,
            access_token: 'test-token',
            expires_in: 3600,
            user: { id: 'server-user', displayName: '服务端成员', status: 'ACTIVE' },
            club: { id: 'server-club', slug: 'rak-club', name: 'Rak 社团', role: 'manager' },
          }
        : options.url.endsWith('/me')
          ? {
              user: { id: 'server-user', displayName: '服务端成员', email: null, status: 'ACTIVE' },
              club: { id: 'server-club', slug: 'rak-club', name: 'Rak 社团' },
              clubRole: 'manager',
              permissions: ['task:publish'],
            }
        : {}) as never
    },
    clubBase: () => '/api/v1/clubs/demo-club',
    query: () => '?page=2&size=5',
    login: async () => ({ code: 'wx-code' }),
    wechatBase: '/api/ui/wechat/miniprogram',
    setToken: (token: string) => tokens.push(token),
  }
  const tokens: string[] = []

  const auth = createAuthService({ ...context, demo: () => context.demo().auth })

  const login = await auth.wxLogin()
  await auth.bind('INVITE', '测试成员')
  await auth.submitJoinRequest({ name: '测试成员', wechat: 'test-wechat', reason: '测试申请' })
  await auth.fetchJoinStatus()
  const me = await auth.fetchMe()
  const tasks = createTaskService({ ...context, demo: () => context.demo().task })
  const announcements = createAnnouncementService({ ...context, demo: () => context.demo().club })
  const roi = createRoiService({ ...context, demo: () => context.demo().roi })
  const taskInput = { title: 'API 任务', description: '契约请求', category: 'ops' }
  const announcementInput = { title: 'API 公告', body: '契约请求', pinned: false }
  const roiInput = { title: 'API 活动', category: 'activity' as const, cost: 100, revenue: 250 }

  await tasks.fetchTasks({ page: 2, size: 5 })
  await tasks.fetchTask('task-1')
  await tasks.publishTask(taskInput)
  await tasks.updateTask('task-1', taskInput)
  await tasks.claimTask('task-1')
  await tasks.submitTask('task-1', '已完成')
  assert.throws(
    () => tasks.submitTask('task-1', '包含附件', [{
      id: 'api-attachment',
      name: '成果.7z',
      size: 1024,
      localPath: 'wxfile://local/成果.7z',
    }]),
    /Rak 服务端尚未定义任务附件上传接口/
  )
  await tasks.approveTask('task-1', 'A', '验收通过')
  await tasks.rejectTask('task-1', '请补充材料')
  await tasks.archiveTask('task-1')
  await announcements.fetchAnnouncements(2, 5)
  await announcements.fetchAnnouncement('announcement-1')
  await announcements.createAnnouncement(announcementInput)
  await announcements.updateAnnouncement('announcement-1', { body: '更新内容' })
  await announcements.publishAnnouncement('announcement-1')
  await announcements.archiveAnnouncement('announcement-1')
  await roi.fetchRoiItems({ page: 2, size: 5 })
  await roi.fetchRoiItem('roi-1')
  await roi.createRoiItem(roiInput)
  await roi.updateRoiItem('roi-1', roiInput)
  await roi.deleteRoiItem('roi-1')
  await roi.fetchRoiOverview('quarter')
  await tasks.fetchAllMemberPerformance()
  await tasks.fetchMemberPerformance('server-user')

  assert.deepEqual(calls, [
    {
      url: '/api/ui/wechat/miniprogram/login',
      method: 'POST',
      data: { code: 'wx-code' },
      auth: false,
    },
    {
      url: '/api/ui/wechat/miniprogram/bind',
      method: 'POST',
      data: { code: 'wx-code', inviteCode: 'INVITE', displayName: '测试成员' },
      auth: false,
    },
    {
      url: '/api/ui/wechat/miniprogram/join-request',
      method: 'POST',
      data: {
        code: 'wx-code',
        applicantName: '测试成员',
        applicantWechat: 'test-wechat',
        reason: '测试申请',
      },
      auth: false,
    },
    {
      url: '/api/ui/wechat/miniprogram/join-request',
      data: { code: 'wx-code' },
      auth: false,
    },
    { url: '/api/ui/wechat/miniprogram/me' },
    { url: '/api/v1/clubs/demo-club/tasks?page=2&size=5' },
    { url: '/api/v1/clubs/demo-club/tasks/task-1' },
    { url: '/api/v1/clubs/demo-club/tasks', method: 'POST', data: taskInput },
    { url: '/api/v1/clubs/demo-club/tasks/task-1', method: 'PATCH', data: taskInput },
    { url: '/api/v1/clubs/demo-club/tasks/task-1/claim', method: 'POST' },
    { url: '/api/v1/clubs/demo-club/tasks/task-1/submit', method: 'POST', data: { note: '已完成' } },
    { url: '/api/v1/clubs/demo-club/tasks/task-1/approve', method: 'POST', data: { grade: 'A', note: '验收通过' } },
    { url: '/api/v1/clubs/demo-club/tasks/task-1/reject', method: 'POST', data: { reason: '请补充材料' } },
    { url: '/api/v1/clubs/demo-club/tasks/task-1/archive', method: 'POST' },
    { url: '/api/v1/clubs/demo-club/announcements?page=2&size=5' },
    { url: '/api/v1/clubs/demo-club/announcements/announcement-1' },
    {
      url: '/api/v1/clubs/demo-club/announcements',
      method: 'POST',
      data: announcementInput,
    },
    { url: '/api/v1/clubs/demo-club/announcements/announcement-1', method: 'PATCH', data: { body: '更新内容' } },
    { url: '/api/v1/clubs/demo-club/announcements/announcement-1/publish', method: 'POST' },
    { url: '/api/v1/clubs/demo-club/announcements/announcement-1', method: 'DELETE' },
    { url: '/api/v1/clubs/demo-club/roi/items?page=2&size=5' },
    { url: '/api/v1/clubs/demo-club/roi/items/roi-1' },
    { url: '/api/v1/clubs/demo-club/roi/items', method: 'POST', data: roiInput },
    { url: '/api/v1/clubs/demo-club/roi/items/roi-1', method: 'PATCH', data: roiInput },
    { url: '/api/v1/clubs/demo-club/roi/items/roi-1', method: 'DELETE' },
    { url: '/api/v1/clubs/demo-club/roi/overview?period=quarter' },
    { url: '/api/v1/clubs/demo-club/performance' },
    { url: '/api/v1/clubs/demo-club/members/server-user/performance' },
  ])
  assert.deepEqual(tokens, ['test-token', 'test-token'])
  assert.equal(login.accessToken, 'test-token')
  assert.equal(login.expiresIn, 3600)
  assert.equal(login.user?.email, null)
  assert.equal(login.club?.clubRole, 'manager')
  assert.equal(me.club.clubRole, 'manager')
  assert.deepEqual(me.permissions, ['task:publish'])
})
