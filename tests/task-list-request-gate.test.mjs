import assert from 'node:assert/strict'
import test from 'node:test'
import { TaskListRequestGate } from '../src/utils/task-list-request-gate.ts'

test('a newer filter generation makes older responses ineligible to commit', () => {
  const gate = new TaskListRequestGate()
  const oldFilter = gate.beginRefresh()
  const newFilter = gate.beginRefresh()
  let visibleItems = []

  const applyResponse = (request, items) => {
    if (gate.commit(request)) visibleItems = items
  }
  applyResponse(newFilter, ['new filter result'])
  applyResponse(oldFilter, ['stale result'])

  assert.deepEqual(visibleItems, ['new filter result'])
})

test('a failed page can be requested again until a successful response commits it', () => {
  const gate = new TaskListRequestGate()
  const firstPage = gate.beginRefresh()
  assert.equal(gate.commit(firstPage), true)

  const failedPage = gate.beginNextPage()
  assert.deepEqual(failedPage, { generation: 1, page: 1 })
  // A failed request does not call commit, so the next attempt uses the same page.
  assert.deepEqual(gate.beginNextPage(), failedPage)
  assert.equal(gate.commit(failedPage), true)
  assert.deepEqual(gate.beginNextPage(), { generation: 1, page: 2 })
})
