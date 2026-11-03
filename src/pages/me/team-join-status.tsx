import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import PageShell from '@/components/page-shell'
import { Card, StatusPill } from '@/components/ui'
import { authStore } from '@/store'
import { ROUTES } from '@/constants'
import './team-join-status.scss'

/**
 * 入队申请进度（多团队 DESIGN §7.2、PLAN M7）。
 *
 * 账户级 GLOBAL 列表：只显示**本人**申请当前状态，用于"仅待审"这一确定落点。
 * 不展示其他队关系；通过后仍需在"切换团队"中显式进入（不自动替换当前团队）。
 */
const STATUS_TEXT: Record<string, string> = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '未通过' }

function TeamJoinStatus() {
  async function load(cursor?: string) {
    await authStore.loadMyJoins(cursor ? { cursor } : {})
  }

  useDidShow(() => {
    if (!authStore.isCloud || !authStore.cloudAccountIdentified) return
    void load()
  })

  const joins = authStore.myJoins
  const empty = authStore.isCloud && !authStore.myJoinsError && !authStore.myJoinsLoading && joins.length === 0

  return (
    <PageShell kicker='JOIN' headTitle='入队进度' showBack>
      <View className='stack-gap fade-in'>
        {!authStore.isCloud ? (
          <Card>
            <Text className='text-card-title'>当前构建不支持多团队</Text>
            <Text className='text-caption'>入队进度仅在云端正式包提供。</Text>
          </Card>
        ) : null}

        {authStore.isCloud && authStore.myJoinsError ? (
          <Card>
            <Text className='text-card-title'>加载失败</Text>
            <Text className='text-caption'>{authStore.myJoinsError}</Text>
            <View className='btn-secondary pressable' onClick={() => void load()}>
              <Text>重试</Text>
            </View>
          </Card>
        ) : null}

        {empty ? (
          <Card>
            <Text className='text-card-title'>暂无入队申请</Text>
            <Text className='text-caption'>通过邀请码或入队链接提交申请后，进度会显示在这里。</Text>
          </Card>
        ) : null}

        {joins.map((item) => (
          <View key={item.joinRequestId} className='join-row'>
            <View className='flex-1'>
              <Text className='text-card-title'>{item.clubName || item.clubId}</Text>
              <Text className='text-caption'>
                {item.name}
                {item.reviewedAt ? ` · ${item.reviewedAt.slice(0, 10)}` : ''}
              </Text>
            </View>
            <StatusPill text={STATUS_TEXT[item.status] ?? item.status} />
          </View>
        ))}

        {authStore.isCloud && authStore.myJoinsHasMore ? (
          <View
            className='btn-secondary pressable'
            onClick={() => void load(authStore.myJoinsCursor ?? undefined)}
          >
            <Text>{authStore.myJoinsLoading ? '加载中…' : '加载更多'}</Text>
          </View>
        ) : null}

        <View className='btn-secondary pressable' onClick={() => Taro.navigateTo({ url: ROUTES.teamJoin })}>
          <Text>加入其他团队</Text>
        </View>
        <View className='btn-secondary pressable' onClick={() => Taro.navigateTo({ url: ROUTES.teamSelect })}>
          <Text>去切换团队</Text>
        </View>
      </View>
    </PageShell>
  )
}

export default observer(TeamJoinStatus)
