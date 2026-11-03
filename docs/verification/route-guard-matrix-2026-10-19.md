# 路由守卫矩阵（2026-10-19）

由 `pnpm verify:routes` 从 `src/app.config.ts` **自动生成**；不要手工编辑。
作用域：业务页 = TEAM.clubId（需 activeTeam）；账户页 = GLOBAL/账户级。
守卫：PageShell 负责"先 bootstrap/enter 再 load"与角色校验；账户页豁免以便处理未识别态。

| 路由 | 作用域 | 守卫 | requireRole | 生命周期钩子 |
|---|---|---|---|---|
| `pages/auth/login` | GLOBAL/账户 | 守卫豁免（账户页） | — | useDidShow + useEffect |
| `pages/index/index` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `pages/task/pool` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `pages/task/detail` | TEAM.clubId | PageShell | — | useDidShow |
| `pages/roi/overview` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `pages/roi/list` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `pages/roi/detail` | TEAM.clubId | PageShell | — | useDidShow |
| `pages/club/home` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `pages/club/announcement-list` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `pages/club/announcement-detail` | TEAM.clubId | PageShell | — | useEffect |
| `pages/club/members` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `pages/me/profile` | TEAM.clubId | PageShell | — | useDidShow |
| `pages/me/tasks` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `pages/me/performance` | TEAM.clubId | PageShell | — | useDidShow |
| `pages/me/settings` | TEAM.clubId | PageShell | — | — |
| `pages/me/team-select` | TEAM.clubId | PageShell | — | useDidShow + useEffect |
| `pages/me/team-join` | TEAM.clubId | PageShell | — | useDidShow |
| `pages/me/team-join-status` | TEAM.clubId | PageShell | — | useDidShow |
| `pages/me/team-profile` | TEAM.clubId | PageShell | — | useDidShow + useEffect |
| `pages/me/new-team` | TEAM.clubId | PageShell | — | useDidShow |
| `pages/me/new-team-applications` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `pages/me/account` | TEAM.clubId | PageShell | — | — |
| `pages/auth/join-status` | GLOBAL/账户 | 守卫豁免（账户页） | — | useDidShow |
| `subpackage-admin/pages/admin/home` | TEAM.clubId | PageShell | — | useDidShow |
| `subpackage-admin/pages/admin/task-publish` | TEAM.clubId | PageShell | — | — |
| `subpackage-admin/pages/admin/review` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `subpackage-admin/pages/admin/roi-edit` | TEAM.clubId | PageShell | — | useEffect |
| `subpackage-admin/pages/admin/members` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `subpackage-admin/pages/admin/join-requests` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `subpackage-admin/pages/admin/dismissals` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `subpackage-admin/pages/admin/dissolutions` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `subpackage-admin/pages/admin/invites` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `subpackage-admin/pages/admin/announcements` | TEAM.clubId | PageShell | — | useDidShow + usePullDownRefresh |
| `subpackage-admin/pages/admin/club-settings` | TEAM.clubId | PageShell | — | useEffect |
| `subpackage-admin/pages/super/roles` | TEAM.clubId | PageShell | — | useDidShow |

合计 35 个路由；业务页 33 个，账户页 2 个。
