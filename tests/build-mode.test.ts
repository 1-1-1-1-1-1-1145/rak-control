import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBuildMode } from '../config/build-mode.ts'

test('开发构建默认本地演示，不需要 API/云环境', () => {
  assert.deepEqual(resolveBuildMode({ NODE_ENV: 'development' }), {
    development: true,
    backend: 'demo',
    demoMode: true,
    apiBase: '',
    cloudEnv: '',
    appId: '',
  })
})

test('生产必须显式指定后端；不再允许默认演示', () => {
  assert.throws(() => resolveBuildMode({ NODE_ENV: 'production' }), /TARO_APP_BACKEND/)
})

test('生产 cloud 模式需要 TARO_APP_CLOUD_ENV', () => {
  assert.throws(
    () => resolveBuildMode({ NODE_ENV: 'production', TARO_APP_BACKEND: 'cloud' }),
    /TARO_APP_CLOUD_ENV/
  )
  assert.deepEqual(
    resolveBuildMode({
      NODE_ENV: 'production',
      TARO_APP_BACKEND: 'cloud',
      TARO_APP_CLOUD_ENV: 'cloud1-env',
      TARO_APP_ID: 'wxa8bf102dcfdcec4c',
    }),
    {
      development: false,
      backend: 'cloud',
      demoMode: false,
      apiBase: '',
      cloudEnv: 'cloud1-env',
      appId: 'wxa8bf102dcfdcec4c',
    }
  )
})

test('cloud 模式拒绝 API_BASE（矛盾变量），cloud 不用 HTTP 地址', () => {
  assert.throws(
    () =>
      resolveBuildMode({
        NODE_ENV: 'production',
        TARO_APP_BACKEND: 'cloud',
        TARO_APP_CLOUD_ENV: 'cloud1-env',
        TARO_APP_API_BASE: 'https://api.example.com',
      }),
    /不使用 TARO_APP_API_BASE/
  )
})

test('demo 仅允许开发构建；与显式非 demo 后端冲突即失败', () => {
  assert.throws(
    () => resolveBuildMode({ NODE_ENV: 'production', TARO_APP_BACKEND: 'demo' }),
    /only allowed in development/
  )
  assert.throws(
    () =>
      resolveBuildMode({
        NODE_ENV: 'production',
        TARO_APP_BACKEND: 'cloud',
        TARO_APP_CLOUD_ENV: 'cloud1-env',
        TARO_APP_DEMO: 'true',
      }),
    /conflicts/
  )
})

test('legacy http 保留为显式选项：需要 HTTPS（开发允许本机 HTTP）', () => {
  assert.throws(
    () => resolveBuildMode({ NODE_ENV: 'production', TARO_APP_BACKEND: 'http' }),
    /TARO_APP_API_BASE/
  )
  assert.throws(
    () =>
      resolveBuildMode({
        NODE_ENV: 'production',
        TARO_APP_BACKEND: 'http',
        TARO_APP_API_BASE: 'http://api.example.com',
      }),
    /HTTPS/
  )
  assert.deepEqual(
    resolveBuildMode({
      NODE_ENV: 'production',
      TARO_APP_BACKEND: 'http',
      TARO_APP_API_BASE: 'https://api.example.com',
    }),
    {
      development: false,
      backend: 'http',
      demoMode: false,
      apiBase: 'https://api.example.com',
      cloudEnv: '',
      appId: '',
    }
  )
})

test('显式关闭演示的开发构建走 http 并需要 API_BASE', () => {
  assert.throws(
    () => resolveBuildMode({ NODE_ENV: 'development', TARO_APP_DEMO: 'false' }),
    /TARO_APP_API_BASE/
  )
  assert.deepEqual(
    resolveBuildMode({
      NODE_ENV: 'development',
      TARO_APP_DEMO: 'false',
      TARO_APP_API_BASE: 'http://localhost:8080',
    }),
    {
      development: true,
      backend: 'http',
      demoMode: false,
      apiBase: 'http://localhost:8080',
      cloudEnv: '',
      appId: '',
    }
  )
})

test('TARO_APP_BACKEND 与 TARO_APP_DEMO 取值非法即失败', () => {
  assert.throws(() => resolveBuildMode({ NODE_ENV: 'development', TARO_APP_BACKEND: 'weird' }), /TARO_APP_BACKEND/)
  assert.throws(() => resolveBuildMode({ NODE_ENV: 'development', TARO_APP_DEMO: 'yes' }), /TARO_APP_DEMO/)
})
