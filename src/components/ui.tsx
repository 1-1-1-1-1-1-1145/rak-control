import { View, Text } from '@tarojs/components'
import type { ReactNode } from 'react'
import { relTime } from '@/utils/format'
import { TASK_CATEGORY_LABEL, TASK_STATUS_LABEL, type Task } from '@/types/domain'
import './ui.scss'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <View className={`surface-card ${className}`}>{children}</View>
}

/* ===== 杂志 Bento 模式（spec 2026-09-19 §2） ===== */

/** 刊头：kicker 英文小标 + display 中文大标题 + 右侧状态胶囊 */
export function MagHead({ kicker, title, status }: {
  kicker: string
  title: ReactNode
  status?: ReactNode
}) {
  return (
    <View className='mag-head'>
      <View className='flex-1'>
        <Text className='text-kicker'>{kicker}</Text>
        <Text className='mag-head__title'>{title}</Text>
      </View>
      {status ? <View className='mag-head__status'>{status}</View> : null}
    </View>
  )
}

/** 刊头右侧状态胶囊（可带绿点） */
export function StatusPill({ dot, text }: { dot?: boolean; text: string }) {
  return (
    <View className='status-pill'>
      {dot ? <View className='status-pill__dot' /> : null}
      <Text>{text}</Text>
    </View>
  )
}

/** 主角块：每屏 ≤1 的实底强调色块，action 装主操作 / metric 装 hero 数据 */
export function HeroBlock({ variant = 'action', title, desc, onClick, children }: {
  variant?: 'action' | 'metric'
  title?: ReactNode
  desc?: ReactNode
  onClick?: () => void
  children?: ReactNode
}) {
  return (
    <View className={`hero-block hero-block--${variant}`} onClick={onClick}>
      <View className='flex-1'>
        {title ? <View className='hero-block__title'>{title}</View> : null}
        {desc ? <View className='hero-block__desc'>{desc}</View> : null}
        {children}
      </View>
      {variant === 'action' ? <Text className='hero-block__arrow'>›</Text> : null}
    </View>
  )
}

/** 2 列宫格容器 */
export function TileGrid({ children }: { children: ReactNode }) {
  return <View className='tile-grid stagger-in'>{children}</View>
}

/** 宫格入口：solid/white/paper 三种卡面，右上角圆形徽章 */
export function Tile({ face = 'white', mark, title, desc, onClick, children }: {
  face?: 'solid' | 'white' | 'paper'
  mark?: 'arrow' | 'check' | null
  title: ReactNode
  desc?: ReactNode
  onClick?: () => void
  children?: ReactNode
}) {
  return (
    <View
      className={`tile tile--${face} tile--pressable stagger-item`}
      onClick={onClick}
    >
      {mark ? (
        <View className={`tile__mark tile__mark--${mark}`}>
          <Text>{mark === 'check' ? '✓' : '›'}</Text>
        </View>
      ) : null}
      {children}
      <Text className='tile__title'>{title}</Text>
      {desc ? <View className='tile__desc'>{desc}</View> : null}
    </View>
  )
}

export function RoleBadge({ role }: { role?: string | null }) {
  if (role === 'super_admin') {
    return (
      <View className='badge badge--brand'>
        <Text>超管</Text>
      </View>
    )
  }
  if (role === 'manager') {
    return (
      <View className='badge badge--success'>
        <Text>管理层</Text>
      </View>
    )
  }
  return (
    <View className='badge'>
      <Text>成员</Text>
    </View>
  )
}

/** 任务卡（全站统一：池/首页/我的/验收队列） */
export function TaskCard({
  task,
  onPress,
  compact = false,
}: {
  task: Task
  onPress?: () => void
  compact?: boolean
}) {
  return (
    <View
      className={`task-card pressable task-card--${task.status.toLowerCase()}`}
      onClick={onPress}
    >
      <View className='task-card__strip' />
      <View className='task-card__body'>
        <View className='row-between'>
          <Text className='text-card-title task-card__title'>{task.title}</Text>
          <View className={`badge badge--${statusTone(task.status)}`}>
            <Text>{TASK_STATUS_LABEL[task.status]}</Text>
          </View>
        </View>
        {!compact ? (
          <Text className='text-caption task-card__desc'>
            {task.description.length > 44
              ? `${task.description.slice(0, 44)}…`
              : task.description}
          </Text>
        ) : null}
        <View className='row-between task-card__meta'>
          <View className='row-gap task-card__meta-categories'>
            <View className='chip'>
              <Text>{TASK_CATEGORY_LABEL[task.category] || task.category}</Text>
            </View>
            {task.repo ? (
              <Text className='text-caption text-mono'>@{task.repo}</Text>
            ) : null}
            {task.submissionAttachments?.length ? (
              <View className='chip task-card__attachments'>
                <Text>附件 {task.submissionAttachments.length}</Text>
              </View>
            ) : null}
          </View>
          <Text className='text-caption'>
            {task.assigneeName
              ? `${task.assigneeName} · ${relTime(task.claimedAt)}`
              : relTime(task.updatedAt)}
          </Text>
        </View>
      </View>
    </View>
  )
}

function statusTone(status: Task['status']): string {
  switch (status) {
    case 'OPEN':
      return 'brand'
    case 'CLAIMED':
      return 'warning'
    case 'SUBMITTED':
      return 'brand'
    case 'APPROVED':
    case 'DONE':
      return 'success'
    case 'REJECTED':
      return 'destructive'
    default:
      return ''
  }
}
