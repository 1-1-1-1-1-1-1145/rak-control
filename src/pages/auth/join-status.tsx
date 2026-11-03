import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import { ROUTES } from '@/constants'
import { MagHead } from '@/components/ui'
import { authStore, uiStore } from '@/store'
import * as authService from '@/services/auth'
import { ApiError } from '@/utils/request'
import { formatDateTime } from '@/utils/format'
import type { JoinStatusView } from '@/types/domain'
import './login.scss'

function JoinStatus() {
  const [view, setView] = useState<JoinStatusView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useDidShow(() => {
    // cloud：入队进度由独立页（teamJoinStatus）承载；本页仅服务旧版邀请码入队，
    // 不做 legacy HTTP 调用，直接落到确定的 cloud 落点。
    if (authStore.isCloud) {
      Taro.reLaunch({ url: ROUTES.teamJoinStatus })
      return
    }
    setLoading(true)
    authService
      .fetchJoinStatus()
      .then((v) => {
        setView(v)
        setError('')
      })
      .catch((e) => setError(e instanceof ApiError ? e.userMessage : '查询失败'))
      .finally(() => setLoading(false))
  })

  const step =
    view?.status === 'PENDING' ? 1 : view?.status === 'APPROVED' ? 2 : view?.status === 'REJECTED' ? -1 : 0

  return (
    <View className={`page-shell theme-${uiStore.theme}`}>
      <View className='page'>
        <MagHead kicker='STATUS' title='加入进度' />
        <View className='stack-gap fade-in'>
          <View className='surface-card'>
            <Text className='section-label'>入队申请进度</Text>
            {loading ? <Text className='text-caption'>查询中…</Text> : null}
            {error ? (
              <Text className='text-caption' style={{ color: 'var(--color-destructive)' }}>
                {error}
              </Text>
            ) : null}
            {!loading && !error ? (
              <View className='stack-gap' style={{ marginTop: '16rpx' }}>
                <TimelineStep title='提交申请' done time={undefined} />
                <TimelineStep
                  title='管理层审批'
                  done={step >= 2 || step === -1}
                  active={step === 1}
                />
                <TimelineStep
                  title={
                    view?.status === 'APPROVED'
                      ? '已通过 · 重新进入小程序即生效'
                      : view?.status === 'REJECTED'
                        ? '未通过'
                        : '等待结果'
                  }
                  done={step === 2}
                  danger={step === -1}
                  time={view?.reviewedAt}
                />
              </View>
            ) : null}
          </View>

          {view?.status === 'APPROVED' ? (
            <View
              className='btn-primary pressable'
              onClick={() => {
                authStore.clear()
                void authStore.bootstrap()
              }}
            >
              <Text>立即进入 Rak</Text>
            </View>
          ) : null}

          <View
            className='btn-secondary pressable'
            onClick={() => Taro.reLaunch({ url: ROUTES.login })}
          >
            <Text>返回</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

function TimelineStep({
  title,
  done,
  active,
  danger,
  time,
}: {
  title: string
  done?: boolean
  active?: boolean
  danger?: boolean
  time?: string | null
}) {
  const dot = danger
    ? 'timeline-dot timeline-dot--danger'
    : done
      ? 'timeline-dot timeline-dot--done'
      : active
        ? 'timeline-dot timeline-dot--active'
        : 'timeline-dot'
  return (
    <View className='timeline-step'>
      <View className={dot} />
      <View className='timeline-step__body'>
        <Text className='text-card-title'>{title}</Text>
        {time ? <Text className='text-caption'>{formatDateTime(time)}</Text> : null}
      </View>
    </View>
  )
}

export default observer(JoinStatus)
