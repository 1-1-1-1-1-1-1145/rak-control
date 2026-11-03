import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useEffect, useState } from 'react'
import { APP_NAME, DEMO_MODE, ROUTES } from '@/constants'
import { authStore, uiStore } from '@/store'
import { ensureAppBooted } from '@/store/app-boot'
import * as authService from '@/services/auth'
import { ApiError } from '@/utils/request'
import { decideLoginLanding } from '@/utils/team-guard'
import './login.scss'

function Login() {
  const [tab, setTab] = useState<'invite' | 'join'>('invite')
  const [inviteCode, setInviteCode] = useState('')
  const [name, setName] = useState('')
  const [wechat, setWechat] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 扫码进入：/pages/auth/login?invite=CODE（API.md §6.2）
  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params || {}
    const q = (params.invite as string) || ''
    if (q) {
      setInviteCode(q.toUpperCase())
      setTab('invite')
    }
  }, [])

  useEffect(() => {
    if (authStore.status === 'AUTHED') {
      Taro.reLaunch({ url: ROUTES.index })
    }
  }, [authStore.status])

  // cloud：账户已识别但尚未进入任何本队（含 0 队）→ 离开登录页。
  // 否则 cloud 模式下登录页只有 loading、无任何可点入口，会永久卡住（0 队空态在选队页）。
  useEffect(() => {
    const landing = decideLoginLanding({
      isCloud: authStore.isCloud,
      accountIdentified: authStore.cloudAccountIdentified,
      hasActiveTeam: Boolean(authStore.cloudActiveTeam),
      state: authStore.cloudTeamState,
    })
    if (landing === 'TEAM_SELECT') Taro.reLaunch({ url: ROUTES.teamSelect })
  }, [
    authStore.isCloud,
    authStore.cloudAccountIdentified,
    authStore.cloudActiveTeam,
    authStore.cloudTeamState,
  ])

  const submitInvite = async () => {
    if (authStore.isCloud) {
      // cloud 正式包不做 legacy 邀请码绑定：走「我的→加入团队」入口
      setErr('云模式下请使用「加入团队」入口，或联系管理层获取申请入口。')
      return
    }
    if (DEMO_MODE) {
      setErr('邀请码绑定需要连接 Rak 服务端。请从设置页切换演示身份。')
      return
    }
    const code = inviteCode.trim().toUpperCase()
    if (code.length < 6) {
      setErr('请输入 7 位邀请码')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const out = await authService.bind(code, name.trim() || undefined)
      authStore.applyLoginOutcome(out)
    } catch (e) {
      setErr(e instanceof ApiError ? e.userMessage : '绑定失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const submitJoin = async () => {
    if (authStore.isCloud) {
      setErr('云模式下请使用「加入团队」入口提交入队申请。')
      return
    }
    if (DEMO_MODE) {
      setErr('入队申请需要连接 Rak 服务端。请从设置页切换演示身份。')
      return
    }
    if (!name.trim() || !wechat.trim() || !reason.trim()) {
      setErr('请完整填写姓名、微信号与申请理由')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await authService.submitJoinRequest({
        name: name.trim(),
        wechat: wechat.trim(),
        reason: reason.trim(),
      })
      authStore.setJoinStatus({ status: 'PENDING', reviewedAt: null, clubName: null })
    } catch (e) {
      setErr(e instanceof ApiError ? e.userMessage : '提交失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const pending = authStore.joinStatus?.status === 'PENDING'

  return (
    <View className={`login theme-${uiStore.theme}`}>
      <View className='login__brand'>
        {DEMO_MODE ? (
          <Text className='text-caption'>本地演示 · 数据仅保存在当前设备</Text>
        ) : null}
        <View className='login__brand-row'>
          <View className='login__logo'>
            <Text className='login__logo-text'>R</Text>
          </View>
          <Text className='text-kicker'>RAK WORKSPACE</Text>
        </View>
        <Text className='login__name'>{APP_NAME}</Text>
        <Text className='login__slogan'>团队任务 · ROI · 一个小程序管好</Text>
      </View>

      <View className='login__panel'>
        {authStore.status === 'LOADING' ? (
          <View className='login__loading'>
            <View className='login__spinner' />
            <Text className='text-caption'>正在安全登录…</Text>
            {/*
              退出登录后（本机会话已清、账户层失效）不会再有 useLaunch；
              这里提供显式恢复入口，避免停在 loading 无任何可点操作。
              热启动（后台驻留再打开）由 App.useDidShow 自动恢复。
            */}
            {authStore.isCloud && !authStore.cloudAccountIdentified ? (
              <View className='btn-secondary pressable' onClick={() => void ensureAppBooted()}>
                <Text>重新进入</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {authStore.status === 'ERROR' ? (
          <View className='login__error'>
            <Text className='text-card-title'>连不上服务器</Text>
            <Text className='text-caption'>{authStore.bootError}</Text>
            <View className='btn-primary pressable' onClick={() => authStore.bootstrap()}>
              <Text>重试</Text>
            </View>
          </View>
        ) : null}

        {pending ? (
          <View className='login__pending'>
            <Text className='text-card-title'>申请已提交，等待审批</Text>
            <Text className='text-caption'>
              管理层通过后，重新进入小程序即可开始使用
            </Text>
            <View
              className='btn-secondary pressable'
              onClick={() => Taro.navigateTo({ url: ROUTES.joinStatus })}
            >
              <Text>查看进度</Text>
            </View>
          </View>
        ) : null}

        {DEMO_MODE && authStore.status === 'UNBOUND' ? (
          <View className='login__error'>
            <Text className='text-card-title'>演示身份已退出</Text>
            <Text className='text-caption'>演示环境不使用微信登录、邀请码或入队申请。</Text>
            <View
              className='btn-primary pressable'
              onClick={async () => authStore.applyLoginOutcome(await authService.wxLogin())}
            >
              <Text>进入管理者演示账号</Text>
            </View>
          </View>
        ) : null}

        {!DEMO_MODE && !authStore.isCloud && authStore.status === 'UNBOUND' && !pending ? (
          <View className='login__form'>
            <View className='seg'>
              <View
                className={`seg__item ${tab === 'invite' ? 'seg__item--on' : ''}`}
                onClick={() => {
                  setTab('invite')
                  setErr('')
                }}
              >
                <Text>邀请码入驻</Text>
              </View>
              <View
                className={`seg__item ${tab === 'join' ? 'seg__item--on' : ''}`}
                onClick={() => {
                  setTab('join')
                  setErr('')
                }}
              >
                <Text>申请加入</Text>
              </View>
            </View>

            {tab === 'invite' ? (
              <View className='stack-gap'>
                <View className='field'>
                  <Text className='field__label'>邀请码</Text>
                  <Input
                    className='field__input field__input--code'
                    value={inviteCode}
                    maxlength={7}
                    placeholder='7 位邀请码（扫码自动填写）'
                    onInput={(e) =>
                      setInviteCode(e.detail.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                  />
                </View>
                <View className='field'>
                  <Text className='field__label'>
                    展示名<Text className='field__optional'>（可选）</Text>
                  </Text>
                  <Input
                    className='field__input'
                    value={name}
                    maxlength={16}
                    placeholder='社团内展示名'
                    onInput={(e) => setName(e.detail.value)}
                  />
                </View>
                <View
                  className={`btn-primary pressable ${busy ? 'btn-primary--disabled' : ''}`}
                  onClick={busy ? undefined : submitInvite}
                >
                  <Text>{busy ? '绑定中…' : '进入 Rak'}</Text>
                </View>
              </View>
            ) : (
              <View className='stack-gap'>
                <View className='field'>
                  <Text className='field__label'>姓名</Text>
                  <Input
                    className='field__input'
                    value={name}
                    maxlength={16}
                    placeholder='你的称呼'
                    onInput={(e) => setName(e.detail.value)}
                  />
                </View>
                <View className='field'>
                  <Text className='field__label'>微信号</Text>
                  <Input
                    className='field__input'
                    value={wechat}
                    maxlength={32}
                    placeholder='便于管理员联系'
                    onInput={(e) => setWechat(e.detail.value)}
                  />
                </View>
                <View className='field'>
                  <Text className='field__label'>申请理由</Text>
                  <Input
                    className='field__input'
                    value={reason}
                    maxlength={80}
                    placeholder='想参与哪类任务？'
                    onInput={(e) => setReason(e.detail.value)}
                  />
                </View>
                <View
                  className={`btn-primary pressable ${busy ? 'btn-primary--disabled' : ''}`}
                  onClick={busy ? undefined : submitJoin}
                >
                  <Text>{busy ? '提交中…' : '提交申请'}</Text>
                </View>
              </View>
            )}

            {err ? <Text className='login__err'>{err}</Text> : null}
          </View>
        ) : null}
      </View>

      <Text className='login__foot'>登录由 rak-auth 统一签发 · 不自建会话</Text>
    </View>
  )
}

export default observer(Login)
