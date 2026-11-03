import { Input, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card } from '@/components/ui'
import { authStore } from '@/store'
import { ROUTES } from '@/constants'
import { cloudInviteRedeem, cloudJoinSubmit, cloudResolveJoinTarget } from '@/services/cloud/team'
import type { JoinTargetResponse } from '@/services/cloud/dto'
import { createMutationId } from '@/utils/mutation-id'
import './team-join.scss'

/**
 * 加入团队（多团队 DESIGN §5.3/§7、PLAN M7）。
 *
 * - 已在 A 的人也能加入 B：本页独立于旧 login，成功**只更新本人账户级状态**，
 *   不自动切换当前团队、不被旧 login 的 AUTHED 自动 reLaunch 覆盖。
 * - 入队申请经 `key`（申请入口）→ resolveJoinTarget 取最小队信息 → join.submit；
 *   邀请码经 `code` → invite.redeem。
 * - 多行字段先 CRLF/CR→LF 再提交（与服务端同规则，服务端仍是最终校验方）。
 */
function TeamJoin() {
  const router = useRouter()
  const params = (router?.params ?? {}) as Record<string, string | undefined>
  const joinKey = params.key ?? ''
  const inviteCode = params.code ?? ''

  const [target, setTarget] = useState<JoinTargetResponse | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [wechat, setWechat] = useState('')
  const [reason, setReason] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState(inviteCode)

  /** 生效的邀请码：链接参数优先，其次手动输入（统一大写、去非法字符）。 */
  const effectiveCode = (inviteCode || codeInput).trim().toUpperCase()

  async function resolveTarget() {
    setResolving(true)
    setResolveError(null)
    try {
      setTarget(await cloudResolveJoinTarget(joinKey))
    } catch (e) {
      setResolveError((e as Error)?.message || '入队链接无效或已失效，请向团队管理员索取新链接')
    } finally {
      setResolving(false)
    }
  }

  useDidShow(() => {
    const preset = authStore.cloudActiveTeam?.displayName ?? ''
    setName((prev) => prev || preset)
    setDisplayName((prev) => prev || preset)
    if (joinKey && !target) void resolveTarget()
  })

  async function submitJoin() {
    if (!target) return
    if (!name.trim() || !wechat.trim() || !reason.trim()) {
      await Taro.showToast({ title: '请填写姓名、微信与加入理由', icon: 'none' })
      return
    }
    setBusy(true)
    try {
      const result = await cloudJoinSubmit(
        {
          joinTargetToken: target.joinTargetToken,
          name: name.trim(),
          wechat: wechat.trim(),
          reason: reason.replace(/\r\n|\r/g, '\n').trim(),
        },
        createMutationId()
      )
      setDone(result.status === 'ALREADY_MEMBER' ? '你已是该团队成员' : '申请已提交，等待管理员审核')
    } catch (e) {
      await Taro.showToast({ title: (e as Error)?.message || '提交失败，请稍后重试', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  async function redeem() {
    if (!displayName.trim()) {
      await Taro.showToast({ title: '请填写在本队显示的姓名', icon: 'none' })
      return
    }
    if (effectiveCode.length !== 12) {
      await Taro.showToast({ title: '请输入 12 位邀请码', icon: 'none' })
      return
    }
    setBusy(true)
    try {
      const result = await cloudInviteRedeem(
        { code: effectiveCode, displayName: displayName.trim() },
        createMutationId()
      )
      setDone(result.status === 'ALREADY_MEMBER' ? '你已是该团队成员' : '已加入团队')
    } catch (e) {
      await Taro.showToast({ title: (e as Error)?.message || '兑换失败，请检查邀请码', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell kicker='JOIN' headTitle='加入团队' showBack>
      <View className='stack-gap fade-in'>
        {!authStore.isCloud ? (
          <Card>
            <Text className='text-card-title'>当前构建不支持多团队</Text>
            <Text className='text-caption'>加入团队仅在云端正式包提供。</Text>
          </Card>
        ) : null}

        {authStore.isCloud && done ? (
          <Card>
            <Text className='text-card-title'>{done}</Text>
            <Text className='text-caption'>加入成功后，可在“切换团队”中进入该团队。</Text>
            <View className='btn-secondary pressable' onClick={() => Taro.navigateTo({ url: ROUTES.teamSelect })}>
              <Text>去切换团队</Text>
            </View>
          </Card>
        ) : null}

        {authStore.isCloud && !done && inviteCode ? (
          <Card>
            <Text className='text-card-title'>加入团队</Text>
            <Text className='text-caption'>邀请码：{inviteCode.slice(0, 4)}····</Text>
            <Input
              className='team-join__input'
              value={displayName}
              placeholder='在本队显示的姓名'
              onInput={(e) => setDisplayName(String(e.detail.value ?? ''))}
            />
            <View className='btn-secondary pressable' onClick={() => void redeem()}>
              <Text>{busy ? '兑换中…' : '加入'}</Text>
            </View>
          </Card>
        ) : null}

        {authStore.isCloud && !done && joinKey ? (
          <Card>
            <Text className='text-card-title'>{target ? target.name : '入队申请'}</Text>
            <Text className='text-caption'>
              {target ? `团队代码 ${target.displayCode}` : resolving ? '正在验证入队链接…' : ''}
            </Text>
            {resolveError ? <Text className='text-caption'>{resolveError}</Text> : null}
            {target ? (
              <>
                <Input
                  className='team-join__input'
                  value={name}
                  placeholder='我的姓名'
                  onInput={(e) => setName(String(e.detail.value ?? ''))}
                />
                <Input
                  className='team-join__input'
                  value={wechat}
                  placeholder='微信号'
                  onInput={(e) => setWechat(String(e.detail.value ?? ''))}
                />
                <Textarea
                  className='team-join__textarea'
                  value={reason}
                  placeholder='加入理由'
                  onInput={(e) => setReason(String(e.detail.value ?? ''))}
                />
                <View className='btn-secondary pressable' onClick={() => void submitJoin()}>
                  <Text>{busy ? '提交中…' : '提交入队申请'}</Text>
                </View>
              </>
            ) : null}
          </Card>
        ) : null}

        {authStore.isCloud && !done && !inviteCode && !joinKey ? (
          <Card>
            <Text className='text-card-title'>输入邀请码加入</Text>
            <Text className='text-caption'>向团队管理员索取 12 位邀请码；也可打开管理员分享的入队链接。</Text>
            <Input
              className='team-join__input'
              value={codeInput}
              maxlength={12}
              placeholder='12 位邀请码'
              onInput={(e) => setCodeInput(String(e.detail.value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <Input
              className='team-join__input'
              value={displayName}
              placeholder='在本队显示的姓名'
              onInput={(e) => setDisplayName(String(e.detail.value ?? ''))}
            />
            <View className='btn-secondary pressable' onClick={() => void redeem()}>
              <Text>{busy ? '兑换中…' : '加入团队'}</Text>
            </View>
            <View className='btn-secondary pressable' onClick={() => Taro.navigateTo({ url: ROUTES.teamSelect })}>
              <Text>去切换团队</Text>
            </View>
          </Card>
        ) : null}
      </View>
    </PageShell>
  )
}

export default observer(TeamJoin)
