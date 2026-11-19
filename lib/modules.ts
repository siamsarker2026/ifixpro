// lib/modules.ts
//
// Shared by the browser and the server: which module guards which page, and
// the matching rule. Module ids are the `id` values in the `modules` table.

// A role may open `moduleId` if it was granted that module, or any module
// under it (e.g. 'reports' is allowed when 'reports/efficiency' is granted,
// so the Reports hub opens and shows only what that role may see).
export function canAccessModule(allowed: string[], moduleId: string) {
  if (allowed.includes('*')) return true
  return allowed.some(m => m === moduleId || m.startsWith(`${moduleId}/`))
}

// Page path prefix -> module id. Longest match wins.
const ROUTE_MODULES: [string, string][] = [
  ['/dashboard/box-builder', 'box-builder'],
  ['/dashboard/parts', 'parts'],
  ['/dashboard/repair-request', 'repair-request'],
  ['/dashboard/repair-receive', 'repair-receive'],
  ['/dashboard/trace-history', 'trace-history'],
  ['/dashboard/stock-master', 'stock-master'],
  ['/dashboard/reports/efficiency', 'reports/efficiency'],
  ['/dashboard/reports/diagnostics-report', 'reports/diagnostics-report'],
  ['/dashboard/reports/damage-parts', 'reports/damage-parts'],
  ['/dashboard/reports/requests', 'reports/requests'],
  ['/dashboard/reports', 'reports'],
  ['/dashboard/settings/users', 'settings/users'],
  ['/dashboard/settings/services', 'settings/services'],
  ['/dashboard/settings/technicians', 'settings/technicians'],
  ['/dashboard/settings/targets', 'settings/targets'],
  ['/dashboard/settings', 'settings'],
]

// null = page open to every signed-in user (the dashboard home).
// Unknown pages under /dashboard map to a module nobody has, so only admins
// see them until they are added here.
export function moduleForPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/dashboard' || path === '/dashboard/account' || path.startsWith('/dashboard/account/')) return null
  let best: [string, string] | undefined
  for (const entry of ROUTE_MODULES) {
    const [prefix] = entry
    if ((path === prefix || path.startsWith(`${prefix}/`)) && (!best || prefix.length > best[0].length)) {
      best = entry
    }
  }
  return best ? best[1] : '__admin_only__'
}
