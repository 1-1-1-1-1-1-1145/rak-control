import { API_BASE, BACKEND, CLUB_API_BASE, DEMO_MODE } from '@/constants'
import { readToken, qs } from '@/utils/request'
import { BackendError } from '@/utils/backend-error.js'
import { currentClubId } from '@/services/context'
import { requestForBackend } from './backend'
import type {
  ClubInfo,
  InviteCode,
} from '@/types/domain'
import { getDemoServicesLazy } from '@/demo/loader'
import { createAnnouncementService } from './domain-entry'

const base = () => `${CLUB_API_BASE}/${currentClubId()}`

/** ===== 公告（API.md §7.4） ===== */
const announcementService = createAnnouncementService({
  demoMode: DEMO_MODE,
  demo: () => getDemoServicesLazy().club,
  request: requestForBackend,
  clubBase: base,
  query: qs,
})

export const {
  fetchAnnouncements,
  fetchAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  archiveAnnouncement,
} = announcementService

/** ===== 邀请码（API.md §7.6） ===== */
export async function fetchInvites(): Promise<InviteCode[]> {
  if (DEMO_MODE) return getDemoServicesLazy().club.fetchInvites()
  return requestForBackend<InviteCode[]>({ url: `${base()}/invites` })
}

export const createInvite = (input?: {
  maxUses?: number
  expiresInDays?: number
}) => DEMO_MODE
  ? getDemoServicesLazy().club.createInvite()
  : requestForBackend<InviteCode>({
      url: `${base()}/invites`,
      method: 'POST',
      data: { maxUses: input?.maxUses ?? 10, expiresInDays: input?.expiresInDays ?? 30 },
    })

export const revokeInvite = (id: string) => DEMO_MODE
  ? getDemoServicesLazy().club.revokeInvite(id)
  : requestForBackend<InviteCode>({ url: `${base()}/invites/${id}`, method: 'DELETE' })

/** 小程序码图片地址（<Image src> 直用；服务端 PNG 流，需 Bearer —— weapp Image 不支持
 *  自定义头，故走下载方案：以 js 拉流转 base64 dataURL 缓存展示） */
const qrMemoryCache = new Map<string, string>()

/**
 * 清空小程序码内存缓存（切队/登出时调用；PLAN §M7 (e)/(j)：受保护展示含 QR 缓存）。
 * 只清本应用内存缓存，不触碰任何已下载/用户另存的文件。
 */
export function clearInviteQrCache(): void {
  qrMemoryCache.clear()
}

export async function fetchInviteQrDataUrl(inv: InviteCode): Promise<string> {
  if (DEMO_MODE) throw new Error('小程序码需要连接 Rak 服务端')
  if (BACKEND === 'cloud') throw new BackendError('not_implemented', '云模式小程序码尚未实现（M3+）')
  const url = `${base()}/invites/${inv.id}/qrcode`
  const hit = qrMemoryCache.get(url)
  if (hit) return hit
  const res = await Taro_requestArrayBuffer(url)
  const dataUrl = `data:image/png;base64,${arrayBufferToBase64(res)}`
  qrMemoryCache.set(url, dataUrl)
  return dataUrl
}

async function Taro_requestArrayBuffer(url: string): Promise<ArrayBuffer> {
  const Taro = (await import('@tarojs/taro')).default
  const res = await Taro.request({
    url: `${API_BASE}${url}`,
    method: 'GET',
    responseType: 'arraybuffer',
    header: { Authorization: `Bearer ${readToken()}` },
  })
  if (res.statusCode !== 200) throw new Error('小程序码生成失败')
  return res.data as ArrayBuffer
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  // 小程序环境无 btoa 保证；用 weapp 兼容实现
  return base64Encode(binary)
}

const B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64Encode(binary: string): string {
  let out = ''
  for (let i = 0; i < binary.length; i += 3) {
    const c0 = binary.charCodeAt(i)
    const c1 = binary.charCodeAt(i + 1)
    const c2 = binary.charCodeAt(i + 2)
    out += B64CHARS[c0 >> 2]
    out += B64CHARS[((c0 & 3) << 4) | (Number.isNaN(c1) ? 0 : c1) >> 4]
    out += Number.isNaN(c1) ? '=' : B64CHARS[((c1 & 15) << 2) | (Number.isNaN(c2) ? 0 : c2) >> 6]
    out += Number.isNaN(c2) ? '=' : B64CHARS[c2 & 63]
  }
  return out
}

/** ===== 社团设置（API.md §7.6） ===== */
export async function fetchClub(): Promise<ClubInfo> {
  if (DEMO_MODE) return getDemoServicesLazy().club.fetchClub()
  return requestForBackend<ClubInfo>({ url: `${base()}` })
}

export const updateClub = (input: {
  name?: string
  description?: string
  logoUrl?: string
  settings?: Record<string, unknown>
}) => DEMO_MODE
  ? getDemoServicesLazy().club.updateClub(input)
  : requestForBackend<ClubInfo>({
      url: `${base()}`,
      method: 'PATCH',
      data: {
        name: input.name,
        description: input.description,
        logoUrl: input.logoUrl,
        settings: input.settings,
      },
    })
