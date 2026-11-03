import assert from 'node:assert/strict'
import test from 'node:test'

import { createMutationId } from '../src/utils/mutation-id.ts'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

test('mutationId 符合服务端 UUIDv7 形状', () => {
  for (const now of [1_700_000_000_000, Date.UTC(2026, 9, 17), 0]) {
    const id = createMutationId(now)
    assert.equal(UUID_V7.test(id), true, `非法格式：${id}`)
    assert.equal(id.length, 36)
    // 内嵌时间可被服务端提取（与 server mutationTimeMs 同算法）
    const embedded = Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16)
    assert.equal(embedded, Math.max(0, Math.floor(now)))
  }
})

test('mutationId 逐一唯一（同一时刻连续生成不重复）', () => {
  const now = 1_800_000_000_000
  const ids = new Set(Array.from({ length: 500 }, () => createMutationId(now)))
  assert.equal(ids.size, 500)
})
