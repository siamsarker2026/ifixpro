// Browser helper: user id -> display name, via /api/user-names.
export async function fetchUserNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)))
  if (unique.length === 0) return new Map()
  try {
    const res = await fetch(`/api/user-names?ids=${unique.join(',')}`, { cache: 'no-store' })
    if (!res.ok) return new Map()
    const { names } = await res.json()
    return new Map(Object.entries(names as Record<string, string>))
  } catch {
    return new Map()
  }
}
