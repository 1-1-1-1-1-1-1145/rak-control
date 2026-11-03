import Taro from '@tarojs/taro'
import { STORAGE_KEYS } from '@/constants'
import { commandTracker } from './command-tracker'

/**
 * 最小命令指针的持久化（PLAN §M4 出口：重启无原 payload 只查询，不虚构重放）。
 *
 * 与 `command-tracker.ts`（纯逻辑）分离：本文件依赖 Taro，仅应用层/服务层使用，
 * 便于纯逻辑模块被 Node 测试直接加载。
 */

export function persistPendingCommands(): void {
  try {
    Taro.setStorageSync(STORAGE_KEYS.pendingCommands, commandTracker.toJSON())
  } catch {
    /* 存储失败不阻断业务；下次写入再试 */
  }
}

/** 冷启动载入：形状非法一律丢弃（`loadFrom` 内校验）。 */
export function restorePendingCommands(): void {
  try {
    commandTracker.loadFrom(Taro.getStorageSync(STORAGE_KEYS.pendingCommands))
  } catch {
    commandTracker.clearAll()
  }
}

/** 换账号/登出：清空指针（旧账号的未知写不得带入新账号）。 */
export function clearPendingCommands(): void {
  commandTracker.clearAll()
  persistPendingCommands()
}
