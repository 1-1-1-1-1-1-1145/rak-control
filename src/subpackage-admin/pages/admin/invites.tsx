import { View, Text, Image } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import PageShell from '@/components/page-shell'
import { Card } from '@/components/ui'
import { ListState } from '@/components/states'
import { teamStore } from '@/store'
import { fetchInviteQrDataUrl } from '@/services/club'
import { toast } from '@/utils/toast'
import { formatDate } from '@/utils/format'
import { DEMO_MODE } from '@/constants'
import type { InviteCode } from '@/types/domain'
import '../../admin.scss'

function AdminInvites() {
  const [loading, setLoading] = useState(true)
  const [qr, setQr] = useState<{ id: string; dataUrl: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = () => teamStore.loadInvites().finally(() => setLoading(false))

  useDidShow(() => {
    void reload()
  })

  usePullDownRefresh(async () => {
    await reload()
    Taro.stopPullDownRefresh()
  })

  const create = async () => {
    setBusy(true)
    try {
      await teamStore.createInvite()
      toast('已生成 30 天 / 10 次邀请码', 'success')
    } catch {
      /* store 已提示 */
    } finally {
      setBusy(false)
    }
  }

  const showQr = async (inv: InviteCode) => {
    if (qr?.id === inv.id) {
      setQr(null)
      return
    }
    try {
      const dataUrl = await fetchInviteQrDataUrl(inv)
      setQr({ id: inv.id, dataUrl })
    } catch {
      toast('小程序码生成失败（需后端启用微信配置）')
    }
  }

  const copy = (code: string) => {
    Taro.setClipboardData({ data: code }).then(() => toast('已复制邀请码', 'success'))
  }

  const revoke = async (inv: InviteCode) => {
    const r = await Taro.showModal({
      title: '作废邀请码',
      content: `${inv.code} 作废后持有者无法再入驻`,
    })
    if (r.confirm) await teamStore.revokeInvite(inv.id)
  }

  const live = (i: InviteCode) =>
    !i.revokedAt && (!i.expiresAt || new Date(i.expiresAt).getTime() > Date.now()) && i.usedCount < i.maxUses

  return (
    <PageShell kicker='INVITES' headTitle='邀请码' showBack requireRole='manage'>
      <View className='stack-gap fade-in'>
        {DEMO_MODE ? (
          <Card>
            <Text className='text-caption'>邀请码与小程序码由 Rak 服务端签发，本地演示不创建真实凭证。</Text>
          </Card>
        ) : (
          <View className={`btn-primary pressable ${busy ? 'btn-primary--disabled' : ''}`} onClick={busy ? undefined : create}>
            <Text>生成新邀请码（30 天 · 10 次）</Text>
          </View>
        )}

        <ListState
          loading={loading && teamStore.invites.length === 0}
          error={null}
          empty={teamStore.invites.length === 0}
          onRetry={reload}
          emptyTitle='还没有邀请码'
          emptyHint={DEMO_MODE ? '连接 Rak 服务端后可生成和管理邀请码' : '生成后分享给新成员，或制成小程序码海报'}
        >
          <Card>
            {teamStore.invites.map((i) => (
              <View key={i.id} className='invite-card'>
                <View className='row-between'>
                  <Text className='invite-code'>{i.code}</Text>
                  <View
                    className={`badge ${live(i) ? 'badge--success' : 'badge--destructive'}`}
                  >
                    <Text>
                      {i.revokedAt ? '已作废' : !live(i) ? '已失效' : '生效中'}
                    </Text>
                  </View>
                </View>
                <Text className='text-caption'>
                  已用 {i.usedCount}/{i.maxUses} · 过期 {formatDate(i.expiresAt)}
                </Text>
                {qr?.id === i.id ? (
                  <Image className='invite-qr' src={qr.dataUrl} mode='aspectFit' showMenuByLongpress />
                ) : null}
                <View className='row-gap'>
                  <Text className='text-caption text-brand' onClick={() => copy(i.code)}>
                    复制
                  </Text>
                  <Text className='text-caption text-brand' onClick={() => showQr(i)}>
                    {qr?.id === i.id ? '收起码' : '小程序码'}
                  </Text>
                  {live(i) ? (
                    <Text className='text-caption text-destructive' onClick={() => revoke(i)}>
                      作废
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>
        </ListState>
      </View>
    </PageShell>
  )
}

export default observer(AdminInvites)
