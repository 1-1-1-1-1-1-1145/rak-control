import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin'
import * as webpack from 'webpack'
import devConfig from './dev'
import prodConfig from './prod'
import { resolveBuildMode } from './build-mode'

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'webpack5'>(async (merge, { command: _cmd, mode }) => {
  const buildMode = resolveBuildMode({
    TARO_MODE: mode,
    NODE_ENV: mode || process.env.NODE_ENV,
    TARO_APP_DEMO: process.env.TARO_APP_DEMO,
    TARO_APP_API_BASE: process.env.TARO_APP_API_BASE,
    TARO_APP_BACKEND: process.env.TARO_APP_BACKEND,
    TARO_APP_CLOUD_ENV: process.env.TARO_APP_CLOUD_ENV,
    TARO_APP_ID: process.env.TARO_APP_ID,
  })
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'rak-control',
    date: '2026-9-18',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: [
      "@tarojs/plugin-generator"
    ],
    defineConstants: {
      __RAK_DEMO_MODE__: JSON.stringify(buildMode.demoMode),
      __RAK_API_BASE__: JSON.stringify(buildMode.apiBase),
      __RAK_BACKEND__: JSON.stringify(buildMode.backend),
      __RAK_CLOUD_ENV__: JSON.stringify(buildMode.cloudEnv),
    },
    copy: {
      patterns: [
        { from: 'src/assets/', to: 'dist/assets/' }
      ],
      options: {
      }
    },
    framework: 'react',
    compiler: 'webpack5',
    cache: {
      enable: false // Webpack 持久化缓存配置，建议开启。默认配置请参考：https://docs.taro.zone/docs/config-detail#cache
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {

          }
        },
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
          config: {
            namingPattern: 'module', // 转换模式，取值为 global/module
            generateScopedName: '[name]__[local]___[hash:base64:5]'
          }
        }
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin)
        // cloud 正式构建：整体忽略演示模块（`src/demo` 内 runtime/adapter/services 是唯一
        // 承载演示人物/角色数据的模块）。CommonJS `require` 的依赖在解析期即登记，
        // `DEMO_MODE` 常量分支无法剔除，故在构建期用 IgnorePlugin 从依赖图中移除。
        // resourceRegExp 匹配请求串（`./runtime`），contextRegExp 匹配发起方目录（src/demo）。
        if (buildMode.backend === 'cloud') {
          chain.plugin('rak-ignore-demo-modules').use(webpack.IgnorePlugin, [
            {
              resourceRegExp: /^\.\/(runtime|adapter|services)$/,
              contextRegExp: /[\\/]demo$/,
            },
          ])
        }
      },
    },
  }


  if (buildMode.development) {
    // 本地开发构建配置（不混淆压缩）
    return merge({}, baseConfig, devConfig)
  }
  // 生产构建配置（默认开启压缩混淆等）
  return merge({}, baseConfig, prodConfig)
})
