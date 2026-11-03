import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeNewTeamForm } from '../src/utils/new-team-form.ts'

/**
 * 开通新团队表单校验（前端即时反馈；服务端同规则且为最终校验方）。
 * 覆盖：规范化、边界长度、字符集、多行规范化、可选简介。
 */

test('合法输入：trim / slug 小写 / 展示码大写', () => {
  const result = normalizeNewTeamForm({
    name: '  摄影社分社  ',
    slug: '  Photo-Branch  ',
    displayCode: ' pb01 ',
    description: '  校园摄影  ',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value, {
    name: '摄影社分社',
    slug: 'photo-branch',
    displayCode: 'PB01',
    description: '校园摄影',
  })
})

test('简介可选：空白 → null；CRLF 统一为 LF', () => {
  const empty = normalizeNewTeamForm({ name: '甲乙', slug: 'ab-cd', displayCode: 'AB12', description: '   ' })
  assert.equal(empty.ok, true)
  if (empty.ok) assert.equal(empty.value.description, null)

  const multi = normalizeNewTeamForm({
    name: '甲乙',
    slug: 'ab-cd',
    displayCode: 'AB12',
    description: '第一行\r\n第二行\r第三行',
  })
  assert.equal(multi.ok, true)
  if (multi.ok) assert.equal(multi.value.description, '第一行\n第二行\n第三行')
})

test('团队名称：2..40 字、拒绝控制字符', () => {
  for (const name of ['', 'x', 'x'.repeat(41), '正常\u0000名称']) {
    const result = normalizeNewTeamForm({ name, slug: 'ab-cd', displayCode: 'AB12' })
    assert.equal(result.ok, false, `名称「${name}」应被拒`)
  }
  for (const name of ['甲乙', 'x'.repeat(40)]) {
    assert.equal(normalizeNewTeamForm({ name, slug: 'ab-cd', displayCode: 'AB12' }).ok, true)
  }
})

test('团队标识：小写字母/数字/短横线、3..32 位、首尾非短横线', () => {
  for (const slug of ['ab', '-abc', 'abc-', 'ab_cd', 'ab cd', 'x'.repeat(33), '中文团队']) {
    const result = normalizeNewTeamForm({ name: '甲乙', slug, displayCode: 'AB12' })
    assert.equal(result.ok, false, `标识「${slug}」应被拒`)
  }
  for (const slug of ['abc', 'a-b', 'a1-b2', 'x'.repeat(32), 'PHOTO-BRANCH']) {
    assert.equal(normalizeNewTeamForm({ name: '甲乙', slug, displayCode: 'AB12' }).ok, true, `标识「${slug}」应通过`)
  }
})

test('展示码：大写字母/数字、4..8 位', () => {
  for (const code of ['', 'ab', 'AB1', 'ABCDEFGHI', 'AB-1', '中文码']) {
    const result = normalizeNewTeamForm({ name: '甲乙', slug: 'ab-cd', displayCode: code })
    assert.equal(result.ok, false, `展示码「${code}」应被拒`)
  }
  for (const code of ['ab12', 'ABCD', 'a1b2c3d4', 'ABCDEFGH']) {
    assert.equal(normalizeNewTeamForm({ name: '甲乙', slug: 'ab-cd', displayCode: code }).ok, true)
  }
})

test('简介：超过 200 字拒绝', () => {
  assert.equal(
    normalizeNewTeamForm({ name: '甲乙', slug: 'ab-cd', displayCode: 'AB12', description: '字'.repeat(201) }).ok,
    false
  )
  assert.equal(
    normalizeNewTeamForm({ name: '甲乙', slug: 'ab-cd', displayCode: 'AB12', description: '字'.repeat(200) }).ok,
    true
  )
})
