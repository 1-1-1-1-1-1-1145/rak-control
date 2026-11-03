function stringValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export class AuthContractError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AuthContractError'
  }
}

function clubRole(value) {
  return value === 'super_admin' || value === 'manager' || value === 'member'
    ? value
    : 'member'
}

function normalizeUser(value) {
  const user = value && typeof value === 'object' ? value : null
  if (!user) throw new AuthContractError('Rak 认证响应缺少成员信息')

  const userId = stringValue(user.id)
  if (!userId) throw new AuthContractError('Rak 认证响应缺少成员 ID')

  if (user.status !== 'ACTIVE') {
    throw new AuthContractError('当前成员已停用或身份状态无效')
  }
  return {
    id: userId,
    displayName: stringValue(user.displayName) || stringValue(user.display_name) || '社团成员',
    email: stringValue(user.email),
    status: 'ACTIVE',
    duty: stringValue(user.duty),
  }
}

function normalizeClub(value, roleValue) {
  const club = value && typeof value === 'object' ? value : null
  if (!club) throw new AuthContractError('Rak 认证响应缺少社团信息')

  const clubId = stringValue(club.id)
  if (!clubId) throw new AuthContractError('Rak 认证响应缺少社团 ID')
  return {
    id: clubId,
    slug: stringValue(club.slug) || '',
    name: stringValue(club.name) || '',
    clubRole: clubRole(roleValue ?? club.clubRole ?? club.club_role ?? club.role),
  }
}

export function normalizeLoginOutcome(value) {
  const response = value && typeof value === 'object' ? value : null
  if (typeof response?.bound !== 'boolean') {
    throw new AuthContractError('Rak 登录响应缺少有效的 bound 标记')
  }
  if (!response.bound) return { bound: false }

  const accessToken = stringValue(response.accessToken) || stringValue(response.access_token)
  if (!accessToken) {
    throw new AuthContractError('Rak 登录响应缺少令牌或身份信息')
  }

  return {
    bound: true,
    accessToken,
    expiresIn: typeof response.expiresIn === 'number'
      ? response.expiresIn
      : typeof response.expires_in === 'number' ? response.expires_in : undefined,
    user: normalizeUser(response.user),
    club: normalizeClub(response.club),
  }
}

export function normalizeMeView(value) {
  const response = value && typeof value === 'object' ? value : null
  if (!response || !Array.isArray(response.permissions)
    || !response.permissions.every((permission) => typeof permission === 'string')) {
    throw new AuthContractError('Rak /me 响应缺少有效的权限信息')
  }

  return {
    user: normalizeUser(response.user),
    club: normalizeClub(response.club, response.clubRole ?? response.club_role),
    permissions: response.permissions,
  }
}
