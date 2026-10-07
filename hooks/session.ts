import type { Account } from '../types'

const PLANS: Record<string, string> = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' }

/** Reads `claude auth status --json` into the account the header shows, or null when no one is signed in. */
export const parseAccount = (stdout: string): Account | null => {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || raw.loggedIn !== true || typeof raw.email !== 'string') return null
  const tier = typeof raw.subscriptionType === 'string' ? raw.subscriptionType : undefined

  return { email: raw.email, plan: tier ? (PLANS[tier] ?? tier) : undefined }
}

/** The context bar's color: green with room, yellow under 60% left, red under 30%. */
export const contextTone = (remaining: number) => (remaining < 30 ? 'error' : remaining < 60 ? 'warning' : 'success')
