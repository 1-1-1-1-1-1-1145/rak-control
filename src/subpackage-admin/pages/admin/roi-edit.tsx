import { View, Text, Input, Textarea, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState } from 'react'
import PageShell from '@/components/page-shell'
import { Skeleton } from '@/components/states'
import { authStore, roiStore } from '@/store'
import {
  ROI_CATEGORY_LABEL,
  ROI_STATUS_LABEL,
  type RoiCategory,
  type RoiInput,
  type RoiStatus,
} from '@/types/domain'
import { ApiError } from '@/utils/request'
import { toast } from '@/utils/toast'
import '../../admin.scss'

function RoiEdit() {
  const params = Taro.getCurrentInstance().router?.params || {}
  const mode = params.mode === 'edit' ? 'edit' : 'create'
  const id = params.id || ''

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<RoiCategory>('project')
  const [cost, setCost] = useState('')
  const [revenue, setRevenue] = useState('')
  const [participants, setParticipants] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [status, setStatus] = useState<RoiStatus>('ACTIVE')
  const [notes, setNotes] = useState('')
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(mode === 'edit')
  /** 本页异步回调 ctx 栅栏：切队后迟到结果不写回填/不导航 */
  const loadGeneration = useRef(0)
  const clubIdNow = () => authStore.cloudActiveTeam?.clubId ?? null

  useEffect(() => {
    if (mode !== 'edit' || !id) return
    const generation = ++loadGeneration.current
    const clubBefore = clubIdNow()
    // cloud 走 Store（roi.get，带 clubId 二次校验）；legacy 走原 service
    roiStore
      .fetchOne(id)
      .then((it) => {
        if (!it) return
        if (generation !== loadGeneration.current) return
        if (authStore.isCloud && clubIdNow() !== clubBefore) return
        setTitle(it.title)
        setCategory(it.category)
        setCost(String(it.cost))
        setRevenue(String(it.revenue))
        setParticipants(String(it.participants || ''))
        setPeriodStart(it.periodStart || '')
        setPeriodEnd(it.periodEnd || '')
        setStatus(it.status)
        setNotes(it.notes || '')
      })
      .catch((e) => {
        if (generation !== loadGeneration.current) return
        toast(e instanceof ApiError ? e.userMessage : '加载失败')
      })
      .finally(() => {
        if (generation === loadGeneration.current) setLoading(false)
      })
  }, [])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!title.trim()) e.title = '必填'
    const c = Number(cost || 0)
    const r = Number(revenue || 0)
    if (cost !== '' && (Number.isNaN(c) || c < 0)) e.cost = '非负数字'
    if (revenue !== '' && (Number.isNaN(r) || r < 0)) e.revenue = '非负数字'
    setErrs(e)
    return Object.keys(e).length === 0
  }

  const save = async () => {
    if (!validate()) return
    setBusy(true)
    const input: RoiInput = {
      title: title.trim(),
      category,
      cost: Number(cost || 0),
      revenue: Number(revenue || 0),
      participants: Number(participants || 0),
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      status,
      notes: notes.trim() || null,
    }
    try {
      const clubBefore = clubIdNow()
      if (mode === 'edit' && id) await roiStore.update(id, input)
      else await roiStore.create(input)
      // 切队后不继续导航（旧 A 的保存不在 B 收尾）
      if (authStore.isCloud && clubIdNow() !== clubBefore) return
      setTimeout(() => Taro.navigateBack(), 600)
    } catch {
      /* roiStore 已提示 */
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const r = await Taro.showModal({ title: '删除项目', content: '删除后不可恢复' })
    if (r.confirm && id) {
      const clubBefore = clubIdNow()
      await roiStore.remove(id)
      if (authStore.isCloud && clubIdNow() !== clubBefore) return
      Taro.navigateBack()
    }
  }

  if (loading) {
    return (
      <PageShell kicker='ROI ENTRY' headTitle='录入 ROI' showBack requireRole='manage'>
        <Skeleton rows={2} />
      </PageShell>
    )
  }

  return (
    <PageShell
      kicker='ROI ENTRY'
      headTitle={mode === 'edit' ? '编辑 ROI 项目' : '录入 ROI 项目'}
      showBack
      requireRole='manage'
    >
      <View className='surface-card fade-in'>
        <View className='admin-form'>
          <View className='admin-field'>
            <Text className='admin-field__label'>
              项目名称{errs.title ? <Text className='admin-field__err'> · {errs.title}</Text> : null}
            </Text>
            <Input
              className='admin-input'
              value={title}
              maxlength={64}
              placeholder='如：秋招宣讲会场租'
              onInput={(e) => setTitle(e.detail.value)}
            />
          </View>

          <View className='admin-field'>
            <Text className='admin-field__label'>分类</Text>
            <View className='admin-chips'>
              {(Object.keys(ROI_CATEGORY_LABEL) as RoiCategory[]).map((c) => (
                <View
                  key={c}
                  className={`admin-chip pressable ${category === c ? 'admin-chip--on' : ''}`}
                  onClick={() => setCategory(c)}
                >
                  <Text>{ROI_CATEGORY_LABEL[c]}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className='admin-field'>
            <Text className='admin-field__label'>
              成本（元）{errs.cost ? <Text className='admin-field__err'> · {errs.cost}</Text> : null}
            </Text>
            <Input
              className='admin-input admin-amount'
              type='digit'
              value={cost}
              placeholder='0.00'
              onInput={(e) => setCost(e.detail.value)}
            />
          </View>

          <View className='admin-field'>
            <Text className='admin-field__label'>
              收益（元）{errs.revenue ? <Text className='admin-field__err'> · {errs.revenue}</Text> : null}
            </Text>
            <Input
              className='admin-input admin-amount'
              type='digit'
              value={revenue}
              placeholder='0.00'
              onInput={(e) => setRevenue(e.detail.value)}
            />
          </View>

          <View className='admin-field'>
            <Text className='admin-field__label'>参与人数（可选）</Text>
            <Input
              className='admin-input'
              type='number'
              value={participants}
              maxlength={6}
              placeholder='0'
              onInput={(e) => setParticipants(e.detail.value)}
            />
          </View>

          <View className='admin-field'>
            <Text className='admin-field__label'>周期（可选）</Text>
            <View className='row-gap'>
              <Picker mode='date' value={periodStart} onChange={(e) => setPeriodStart(e.detail.value)}>
                <View className='admin-input' style={{ width: '320rpx' }}>
                  {periodStart || '开始日期'}
                </View>
              </Picker>
              <Picker mode='date' value={periodEnd} onChange={(e) => setPeriodEnd(e.detail.value)}>
                <View className='admin-input' style={{ width: '320rpx' }}>
                  {periodEnd || '结束日期'}
                </View>
              </Picker>
            </View>
          </View>

          <View className='admin-field'>
            <Text className='admin-field__label'>状态</Text>
            <View className='admin-chips'>
              {(Object.keys(ROI_STATUS_LABEL) as RoiStatus[]).map((s) => (
                <View
                  key={s}
                  className={`admin-chip pressable ${status === s ? 'admin-chip--on' : ''}`}
                  onClick={() => setStatus(s)}
                >
                  <Text>{ROI_STATUS_LABEL[s]}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className='admin-field'>
            <Text className='admin-field__label'>备注（可选）</Text>
            <Textarea
              className='admin-textarea'
              style={{ minHeight: '140rpx' }}
              value={notes}
              placeholder='折算口径、发票去向等'
              onInput={(e) => setNotes(e.detail.value)}
            />
          </View>

          <View
            className={`btn-primary pressable ${busy ? 'btn-primary--disabled' : ''}`}
            onClick={busy ? undefined : save}
          >
            <Text>{busy ? '保存中…' : '保存'}</Text>
          </View>

          {mode === 'edit' ? (
            <View className='btn-secondary btn-danger-text pressable' onClick={remove}>
              <Text>删除该项目</Text>
            </View>
          ) : null}
        </View>
      </View>
    </PageShell>
  )
}

export default observer(RoiEdit)
