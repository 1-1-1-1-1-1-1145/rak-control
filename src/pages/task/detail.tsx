import { View, Text, Textarea } from '@tarojs/components'
import Taro, { useDidShow, useUnload } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useRef, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card, HeroBlock, RoleBadge } from '@/components/ui'
import { Skeleton } from '@/components/states'
import { DEMO_MODE } from '@/constants'
import { authStore, taskStore } from '@/store'
import * as taskService from '@/services/task'
import { cloudSubmissionList, cloudTaskGet } from '@/services/cloud/task'
import { toLegacyTask } from '@/services/cloud/legacy-view'
import { ApiError } from '@/utils/request'
import { cloudAttachmentCancel, uploadTaskAttachmentFromPath } from '@/services/cloud/attachment'
import { collectAttachmentIds } from '@/utils/attachment-upload'
import { toast } from '@/utils/toast'
import { formatDateTime } from '@/utils/format'
import {
  formatTaskAttachmentSize,
  isTaskDocumentAttachment,
  isTaskImageAttachment,
  isTaskVideoAttachment,
  MAX_TASK_ATTACHMENTS,
  MAX_TASK_ATTACHMENT_SIZE,
  validateTaskAttachment,
} from '@/utils/task-attachments'
import { TASK_CATEGORY_LABEL, TASK_STATUS_LABEL } from '@/types/domain'
import type { QualityGrade, Task, TaskSubmissionAttachment } from '@/types/domain'
import './detail.scss'

type AttachmentStatus = 'UPLOADING' | 'READY' | 'FAILED'

interface AttachmentRow extends TaskSubmissionAttachment {
  status: AttachmentStatus
  attachmentId?: string
  sessionId?: string
  progressDone?: number
  progressTotal?: number
  errorMessage?: string
}

function attachmentStatusText(attachment: AttachmentRow): string {
  if (attachment.status === 'READY') return '已上传'
  if (attachment.status === 'FAILED') return '上传失败'
  return `上传中 ${attachment.progressDone ?? 0}/${attachment.progressTotal ?? 0}`
}

function TaskDetail() {
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitNote, setSubmitNote] = useState('')
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const attachmentsRef = useRef<AttachmentRow[]>([])
  const [attachmentBusy, setAttachmentBusy] = useState(false)
  /** cloud：交付附件仅计数（M5 未实现 ⇒ 不可打开，不伪造本地路径） */
  const [cloudAttachmentCount, setCloudAttachmentCount] = useState(0)
  const id = Taro.getCurrentInstance().router?.params?.id || ''
  /** 本页异步回调的 ctx 栅栏：每次重载代次 +1，切队后迟到结果一律丢弃 */
  const loadGeneration = useRef(0)
  const clubIdNow = () => authStore.cloudActiveTeam?.clubId ?? null

  /**
   * cloud 详情：公共 Task DTO 只给公共字段；**交付说明/评级/驳回原因**取自
   * `submission.list`（同队且本人或 manager+ 可见），不借用公共 DTO 伪造私有内容。
   */
  const fetchCloudTask = async (clubId: string, generation: number): Promise<Task | null> => {
    const view = await cloudTaskGet(clubId, id)
    const subs = await cloudSubmissionList(clubId, id).catch(() => [])
    if (generation !== loadGeneration.current) return null
    if (authStore.cloudActiveTeam?.clubId !== clubId) return null
    const base = toLegacyTask(view)
    const latest = subs.slice().sort((a, b) => b.round - a.round)[0]
    if (!latest) return base
    setCloudAttachmentCount(latest.attachmentIds.length)
    return {
      ...base,
      submitNote: latest.note,
      qualityGrade:
        latest.status === 'APPROVED' ? ((latest.reviewGrade as QualityGrade | null) ?? null) : null,
      qualityNote: latest.status === 'APPROVED' ? latest.reviewNote : null,
      rejectReason: latest.status === 'REJECTED' ? latest.reviewNote : null,
      submissionAttachments: undefined,
    }
  }

  const refresh = async () => {
    const generation = ++loadGeneration.current
    setCloudAttachmentCount(0)
    try {
      let next: Task | null
      if (authStore.isCloud) {
        const team = authStore.cloudActiveTeam
        if (!team || authStore.cloudTeamState !== 'READY') return
        next = await fetchCloudTask(team.clubId, generation)
        if (!next) return
      } else {
        next = await taskService.fetchTask(id)
      }
      if (generation !== loadGeneration.current) return
      setTask(next)
    } catch (e) {
      if (generation !== loadGeneration.current) return
      toast(e instanceof ApiError ? e.userMessage : '任务不存在')
      setTimeout(() => Taro.navigateBack(), 800)
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }

  useDidShow(() => {
    void refresh()
  })

  // 离开页面时尽力取消未提交的已确认会话，避免遗留批次占位
  useUnload(() => {
    if (!authStore.isCloud) return
    const clubId = authStore.cloudActiveTeam?.clubId
    if (!clubId) return
    for (const row of attachmentsRef.current) {
      if (row.status === 'READY' && row.sessionId) {
        void cloudAttachmentCancel(clubId, row.sessionId).catch(() => undefined)
      }
    }
  })

  if (loading || !task) {
    return (
      <PageShell title='任务详情' kicker='TASK DETAIL' headTitle='任务详情' showBack>
        <Skeleton rows={3} />
      </PageShell>
    )
  }

  const isMine = task.assigneeId === authStore.user?.id
  const mgr = authStore.isManager
  const canSubmit = isMine && (task.status === 'CLAIMED' || task.status === 'REJECTED')
  const attachmentMode: 'cloud' | 'local' | 'unsupported' = authStore.isCloud
    ? 'cloud'
    : DEMO_MODE
      ? 'local'
      : 'unsupported'
  const uploading = attachments.some((item) => item.status === 'UPLOADING')
  attachmentsRef.current = attachments

  const updateAttachment = (rowId: string, patch: Partial<AttachmentRow>) => {
    setAttachments((current) => current.map((item) => (item.id === rowId ? { ...item, ...patch } : item)))
  }

  const runAction = async (fn: Promise<unknown>, after?: () => void) => {
    const clubBefore = clubIdNow()
    try {
      await fn
      // 切队后不继续刷新/导航（旧 A 的动作不在 B 续跑）
      if (authStore.isCloud && clubIdNow() !== clubBefore) return true
      await refresh()
      await taskStore.refresh().catch(() => null)
      after?.()
      return true
    } catch {
      /* taskStore.action 内部已 toast；服务直调失败提示 */
      return false
    }
  }

  const onClaim = async () => {
    const r = await Taro.showModal({ title: '认领任务', content: `确定认领「${task.title}」？` })
    if (r.confirm) await runAction(taskStore.claim(task.id))
  }

  const onChooseAttachments = async () => {
    const generation = loadGeneration.current
    const clubBefore = clubIdNow()
    const remaining = MAX_TASK_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      toast(`最多添加 ${MAX_TASK_ATTACHMENTS} 个附件`)
      return
    }
    setAttachmentBusy(true)
    try {
      const result = await Taro.chooseMessageFile({ count: remaining, type: 'all' })
      // 选择器返回后二次校验本页 ctx：切队/重载后不再读文件或上传
      if (generation !== loadGeneration.current) return
      if (authStore.isCloud && clubIdNow() !== clubBefore) return

      if (attachmentMode === 'cloud') {
        const clubId = clubBefore
        if (!clubId) return
        const expectedTaskRevision = task.revision ?? 0
        for (const file of result.tempFiles) {
          const error = validateTaskAttachment(file.name, file.size)
          if (error) {
            toast(`${file.name}：${error}`)
            continue
          }
          const rowId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          setAttachments((current) =>
            [
              ...current,
              {
                id: rowId,
                name: file.name,
                size: file.size,
                localPath: file.path,
                status: 'UPLOADING' as const,
                progressDone: 0,
                progressTotal: 0,
              },
            ].slice(0, MAX_TASK_ATTACHMENTS)
          )

          // 不调用 saveFile：微信本地存储配额约 10MB，直接使用选择器临时路径上传
          try {
            const uploaded = await uploadTaskAttachmentFromPath({
              clubId,
              taskId: task.id,
              expectedTaskRevision,
              name: file.name,
              size: file.size,
              filePath: file.path,
              onProgress: (done, total) => {
                if (generation !== loadGeneration.current) return
                if (authStore.cloudActiveTeam?.clubId !== clubId) return
                updateAttachment(rowId, { progressDone: done, progressTotal: total })
              },
            })
            if (generation !== loadGeneration.current) return
            if (authStore.cloudActiveTeam?.clubId !== clubId) return
            updateAttachment(rowId, {
              status: 'READY',
              attachmentId: uploaded.attachmentId,
              sessionId: uploaded.sessionId,
              errorMessage: undefined,
            })
          } catch (e) {
            if (generation !== loadGeneration.current) return
            updateAttachment(rowId, {
              status: 'FAILED',
              errorMessage: e instanceof Error ? e.message : '上传失败',
            })
          }
        }
        return
      }

      // local（demo）/ unsupported：保持既有本地保存行为
      const saved: AttachmentRow[] = []
      for (const file of result.tempFiles) {
        const error = validateTaskAttachment(file.name, file.size)
        if (error) {
          toast(`${file.name}：${error}`)
          continue
        }
        try {
          const persisted = await Taro.saveFile({ tempFilePath: file.path })
          if (generation !== loadGeneration.current) return
          if (!('savedFilePath' in persisted) || !persisted.savedFilePath) {
            toast(`${file.name} 保存失败`)
            continue
          }
          saved.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            size: file.size,
            localPath: persisted.savedFilePath,
            status: 'READY',
          })
        } catch {
          toast(`${file.name} 保存失败，可能是本机文件空间不足`)
        }
      }
      if (generation !== loadGeneration.current) return
      setAttachments((current) => [...current, ...saved].slice(0, MAX_TASK_ATTACHMENTS))
    } catch {
      // The picker is dismissed by the user.
    } finally {
      setAttachmentBusy(false)
    }
  }

  const onRemoveAttachment = async (attachment: AttachmentRow) => {
    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
    if (attachmentMode === 'cloud' && attachment.sessionId) {
      const clubId = clubIdNow()
      if (clubId) await cloudAttachmentCancel(clubId, attachment.sessionId).catch(() => undefined)
    }
    // cloud 的 localPath 是临时路径，无需清理；local 才清理本页保存的文件
    if (attachmentMode !== 'cloud') {
      await Taro.removeSavedFile({ filePath: attachment.localPath }).catch(() => undefined)
    }
  }

  const onOpenAttachment = async (attachment: TaskSubmissionAttachment) => {
    try {
      if (isTaskImageAttachment(attachment.name)) {
        await Taro.previewImage({ urls: [attachment.localPath], current: attachment.localPath })
      } else if (isTaskVideoAttachment(attachment.name)) {
        await Taro.previewMedia({ sources: [{ url: attachment.localPath, type: 'video' }] })
      } else {
        const extension = attachment.name.split('.').pop()?.toLowerCase() || ''
        const fileType = isTaskDocumentAttachment(attachment.name)
          ? extension as 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx' | 'pdf'
          : undefined
        await Taro.openDocument({ filePath: attachment.localPath, showMenu: true, fileType })
      }
    } catch {
      toast('此文件暂不支持在微信中预览，可在本机文件中查看')
    }
  }

  const finishSubmitted = async () => {
    const clubBefore = clubIdNow()
    if (attachmentMode !== 'cloud') {
      await Promise.all(
        attachments.map((attachment) =>
          Taro.removeSavedFile({ filePath: attachment.localPath }).catch(() => undefined)
        )
      )
    }
    // 交付清理只清本页新建的本地文件；切队后不再改本页表单状态
    if (authStore.isCloud && clubIdNow() !== clubBefore) return
    setSubmitNote('')
    setAttachments([])
    attachmentsRef.current = []
  }

  const onSubmit = async () => {
    const note = submitNote.trim()
    if (!note) {
      toast('请填写交付说明')
      return
    }
    if (attachmentMode === 'cloud') {
      const { ids, blocker } = collectAttachmentIds(attachments)
      if (blocker === 'UPLOADING') {
        toast('附件仍在上传，请稍候')
        return
      }
      if (blocker === 'FAILED') {
        toast('请移除上传失败的附件后再提交')
        return
      }
      if (await runAction(taskStore.submit(task.id, note, attachments, ids))) await finishSubmitted()
      return
    }
    if (attachments.length && attachmentMode === 'unsupported') {
      toast('当前连接的 Rak 服务端尚未支持附件上传，请先移除附件再提交')
      return
    }
    if (await runAction(taskStore.submit(task.id, note, attachments))) await finishSubmitted()
  }

  const onApprove = async () => {
    const pick = await Taro.showActionSheet({
      itemList: ['A · 优秀（90）', 'B · 良好（75）', 'C · 合格（60）', 'D · 待改进（40）'],
    }).catch(() => null)
    if (!pick) return
    const grade = (['A', 'B', 'C', 'D'] as QualityGrade[])[pick.tapIndex]
    const r = await showModalEditable({
      title: `验收通过 · ${grade}`,
      placeholderText: '评语（可选）',
    })
    if (r.confirm) await runAction(taskStore.approve(task.id, grade, (r.content || '').trim()))
  }

  const onReject = async () => {
    const r = await showModalEditable({
      title: '驳回任务',
      placeholderText: '驳回理由（必填，指出问题与期望）',
    })
    if (!r.confirm) return
    const reason = (r.content || '').trim()
    if (!reason) {
      toast('驳回必须填写理由')
      return
    }
    await runAction(taskStore.reject(task.id, reason))
  }

  const onArchive = async () => {
    const r = await Taro.showModal({ title: '归档任务', content: '归档后不再计入进行中统计' })
    if (r.confirm) await runAction(taskStore.archive(task.id))
  }

  return (
    <PageShell kicker='TASK DETAIL' headTitle='任务详情' showBack>
      <View className='stack-gap fade-in'>
        {/* hero 摘要：标题 + 分类/仓库/状态 */}
        <HeroBlock variant='metric' title={task.title}>
          <View className='row-gap detail-tags'>
            <View className='chip chip--hero'>
              <Text>{TASK_CATEGORY_LABEL[task.category] || task.category}</Text>
            </View>
            {task.repo ? <Text className='detail-tags__repo'>@{task.repo}</Text> : null}
            <View key={task.status} className='badge badge--hero rise-in'>
              <Text>{TASK_STATUS_LABEL[task.status]}</Text>
            </View>
          </View>
        </HeroBlock>

        <Card>
          <Text className='section-label'>任务描述</Text>
          <Text className='text-body'>{task.description}</Text>
        </Card>

        {task.acceptanceCriteria ? (
          <Card>
            <Text className='section-label'>验收标准</Text>
            <Text className='text-body'>{task.acceptanceCriteria}</Text>
          </Card>
        ) : null}

        {/* 交付信息 */}
        {task.submitNote ||
        task.submissionAttachments?.length ||
        task.qualityGrade ||
        task.rejectReason ||
        (authStore.isCloud && cloudAttachmentCount > 0) ? (
          <Card>
            <Text className='section-label'>交付记录</Text>
            {task.submitNote ? (
              <View className='detail-block'>
                <Text className='text-caption'>交付说明</Text>
                <Text className='text-body'>{task.submitNote}</Text>
              </View>
            ) : null}
            {task.submissionAttachments?.length ? (
              <View className='detail-block'>
                <Text className='text-caption'>交付附件 · {task.submissionAttachments.length} 个</Text>
                <View className='attachment-list'>
                  {task.submissionAttachments.map((attachment) => (
                    <View
                      key={attachment.id}
                      className='attachment-row attachment-row--saved pressable'
                      onClick={() => void onOpenAttachment(attachment)}
                    >
                      <View className='attachment-row__copy'>
                        <Text className='attachment-row__name'>{attachment.name}</Text>
                        <Text className='text-caption'>{formatTaskAttachmentSize(attachment.size)}</Text>
                      </View>
                      <Text className='attachment-row__action'>打开</Text>
                    </View>
                  ))}
                </View>
                {attachmentMode === 'local' ? (
                  <Text className='text-caption'>附件保存在本机，仅提交者设备可见。</Text>
                ) : null}
              </View>
            ) : null}
            {authStore.isCloud && cloudAttachmentCount > 0 ? (
              <View className='detail-block'>
                <Text className='text-caption'>
                  交付附件 {cloudAttachmentCount} 个：暂不支持在端内打开已上传附件。
                </Text>
              </View>
            ) : null}
            {task.status === 'APPROVED' || task.status === 'DONE' ? (
              <View className='detail-block'>
                <Text className='text-caption'>
                  验收：
                  <Text className='text-success'>评级 {task.qualityGrade || '—'}</Text>
                </Text>
                {task.reviewedByName ? (
                  <Text className='text-caption'>验收人：{task.reviewedByName}</Text>
                ) : null}
                {task.qualityNote ? <Text className='text-body'>{task.qualityNote}</Text> : null}
              </View>
            ) : null}
            {task.status === 'REJECTED' ? (
              <View className='detail-block detail-block--danger'>
                <Text className='text-caption'>驳回原因</Text>
                <Text className='text-body'>{task.rejectReason}</Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* 状态时间线 */}
        <Card>
          <Text className='section-label'>流转记录</Text>
          <Timeline name='发布' time={actorTime(task.createdByName, task.createdAt)} />
          {task.claimedAt ? (
            <Timeline name='认领' time={actorTime(task.assigneeName, task.claimedAt)} />
          ) : null}
          {task.submittedAt ? (
            <Timeline name='提交' time={actorTime(task.assigneeName, task.submittedAt)} />
          ) : null}
          {task.approvedAt ? (
            <Timeline name='通过' time={actorTime(task.reviewedByName, task.approvedAt)} />
          ) : null}
          {task.rejectedAt ? (
            <Timeline name='驳回' time={actorTime(task.reviewedByName, task.rejectedAt)} danger />
          ) : null}
          {task.status === 'DONE' ? <Timeline name='归档' time={formatDateTime(task.updatedAt)} /> : null}
          {task.assigneeId || task.claimedAt ? (
            <View className='row-between detail-assignee'>
              <Text className='text-caption'>当前负责人</Text>
              <Text className='text-card-title'>{task.assigneeName || '—'}</Text>
            </View>
          ) : (
            <Text className='text-caption'>尚未有人认领</Text>
          )}
        </Card>

        {/* 动作面（按状态与角色渲染；服务端仍是最终防线） */}
        <View className='detail-actions'>
          {task.status === 'OPEN' ? (
            <View className='btn-primary pressable' onClick={onClaim}>
              <Text>认领任务</Text>
            </View>
          ) : null}
          {canSubmit ? (
            <Card>
              <View className='submission-form'>
                <View className='submission-form__heading'>
                  <Text className='section-label'>提交交付</Text>
                  <Text className='text-caption'>说明必填，附件选填</Text>
                </View>
                <Textarea
                  className='form__textarea submission-form__textarea'
                  maxlength={1000}
                  placeholder='说明完成内容、交付位置或需要验收的部分'
                  value={submitNote}
                  onInput={(event) => setSubmitNote(event.detail.value)}
                />
                <View className='submission-form__attachment-head'>
                  <View className='submission-form__attachment-copy'>
                    <Text className='text-card-title'>交付附件</Text>
                    <Text className='text-caption'>任意文件格式 · 单个不超过 {formatTaskAttachmentSize(MAX_TASK_ATTACHMENT_SIZE)}</Text>
                  </View>
                  <Text className='text-caption'>{attachments.length}/{MAX_TASK_ATTACHMENTS}</Text>
                </View>
                {attachments.length ? (
                  <View className='attachment-list'>
                    {attachments.map((attachment) => (
                      <View key={attachment.id} className='attachment-row'>
                        <View className='attachment-row__copy'>
                          <Text className='attachment-row__name'>{attachment.name}</Text>
                          <Text className='text-caption'>
                            {formatTaskAttachmentSize(attachment.size)}
                            {attachmentMode === 'cloud' ? ` · ${attachmentStatusText(attachment)}` : ''}
                          </Text>
                          {attachment.status === 'FAILED' && attachment.errorMessage ? (
                            <Text className='text-caption'>{attachment.errorMessage}</Text>
                          ) : null}
                        </View>
                        <Text
                          className='attachment-row__remove'
                          onClick={attachment.status === 'UPLOADING' ? undefined : () => void onRemoveAttachment(attachment)}
                        >
                          {attachment.status === 'UPLOADING' ? '上传中' : '移除'}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <View
                  className={`btn-secondary submission-form__pick ${attachmentBusy || attachmentMode === 'unsupported' || attachments.length >= MAX_TASK_ATTACHMENTS ? 'submission-form__pick--disabled' : ''}`}
                  onClick={attachmentBusy || attachmentMode === 'unsupported' || attachments.length >= MAX_TASK_ATTACHMENTS
                    ? undefined
                    : onChooseAttachments}
                >
                  <Text>
                    {attachmentBusy
                      ? attachmentMode === 'cloud'
                        ? '正在上传文件…'
                        : '正在保存文件…'
                      : attachmentMode === 'unsupported'
                        ? '服务端暂未支持附件'
                        : attachments.length >= MAX_TASK_ATTACHMENTS
                          ? '已达到附件数量上限'
                          : attachments.length
                            ? '继续添加文件'
                            : '选择交付文件'}
                  </Text>
                </View>
                {attachmentMode === 'cloud' ? (
                  <Text className='submission-form__notice'>附件将上传到团队私有空间；当前版本暂不支持在端内打开已上传附件。</Text>
                ) : attachmentMode === 'unsupported' ? (
                  <Text className='submission-form__notice'>当前连接的 Rak 服务端尚未接入附件上传。完善服务端接口后，成员提交的附件才能供管理员跨设备验收。</Text>
                ) : null}
                <View
                  className={`btn-primary pressable ${taskStore.submitting || attachmentBusy || uploading ? 'btn-primary--disabled' : ''}`}
                  onClick={taskStore.submitting || attachmentBusy || uploading ? undefined : onSubmit}
                >
                  <Text>{task.status === 'REJECTED' ? '修改后重新提交' : '提交验收'}</Text>
                </View>
              </View>
            </Card>
          ) : null}
          {mgr && task.status === 'SUBMITTED' ? (
            <View className='stack-gap'>
              <View className='btn-primary pressable' onClick={onApprove}>
                <Text>验收通过</Text>
              </View>
              <View className='btn-secondary btn-danger-text pressable' onClick={onReject}>
                <Text>驳回</Text>
              </View>
            </View>
          ) : null}
          {mgr && task.status === 'APPROVED' ? (
            <View className='btn-secondary pressable' onClick={onArchive}>
              <Text>归档</Text>
            </View>
          ) : null}
          {authStore.clubRole && !isMine && task.status !== 'OPEN' ? (
            <View className='row-between'>
              <Text className='text-caption'>
                {task.assigneeName ? `由 ${task.assigneeName} 负责` : ''}
              </Text>
              <RoleBadge role={authStore.clubRole} />
            </View>
          ) : null}
        </View>
      </View>
    </PageShell>
  )
}

/** 流转记录：有操作人时显示「姓名 · 时间」，缺失姓名时只显示时间。 */
function actorTime(name: string | null | undefined, at: string | null): string {
  const time = formatDateTime(at)
  return name ? `${name} · ${time}` : time
}

function Timeline({ name, time, danger }: { name: string; time: string; danger?: boolean }) {
  return (
    <View className='timeline-step'>
      <View className={`timeline-dot ${danger ? 'timeline-dot--danger' : 'timeline-dot--done'}`} />
      <View className='timeline-step__body'>
        <Text className='text-card-title'>{name}</Text>
        <Text className='text-caption'>{time}</Text>
      </View>
    </View>
  )
}

/** 微信 showModal 的 editable/content 是运行时能力，Taro 类型未覆盖，此处收口一次 */
function showModalEditable(opts: {
  title: string
  placeholderText?: string
}): Promise<{ confirm: boolean; content?: string }> {
  return Taro.showModal({
    ...opts,
    editable: true,
  } as Taro.showModal.Option) as unknown as Promise<{ confirm: boolean; content?: string }>
}

export default observer(TaskDetail)
