import assert from 'node:assert/strict'
import test from 'node:test'

import { assertCloudActionImplemented, assertNoDemoFallback, isCloudActionImplemented } from '../src/utils/backend-mode.ts'
import { BackendError } from '../src/utils/backend-error.js'

test('未实现的云动作抛 not_implemented（fail-closed，不误走其他适配器）', () => {
  assert.equal(isCloudActionImplemented('task.list'), false)
  assert.throws(
    () => assertCloudActionImplemented('task.list'),
    (e: unknown) => e instanceof BackendError && e.code === 'not_implemented'
  )
})

test('cloud/http 失败不得回退 demo', () => {
  assert.doesNotThrow(() => assertNoDemoFallback('demo', 'demo'))
  assert.doesNotThrow(() => assertNoDemoFallback('cloud', 'cloud'))
  assert.throws(
    () => assertNoDemoFallback('cloud', 'demo'),
    (e: unknown) => e instanceof BackendError && e.code === 'internal_error'
  )
  assert.throws(() => assertNoDemoFallback('http', 'demo'), (e: unknown) => e instanceof BackendError)
})
