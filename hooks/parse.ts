import type { Risk, RiskKind, Snapshot, Step, StepStatus } from '../types'

const STATUSES: readonly StepStatus[] = ['active', 'next', 'blocked']
const KINDS: readonly RiskKind[] = ['question', 'unknown', 'risk']

/** `work`: what workContext says of planning, the approved plan and the task list. */
export const buildPrompt = (previous: Snapshot | null, work = ''): string => {
  const prior = previous
    ? `Your previous assessment, to keep stable (same wording for items that still hold) unless the conversation since then changed it:\n${JSON.stringify(
        {
          title: previous.title,
          objective: previous.objective,
          steps: previous.steps.map(({ text, status }) => ({ text, status })),
          risks: previous.risks.map(({ text, kind }) => ({ text, kind })),
          completion: previous.completion,
        },
      )}\n\n`
    : ''

  return `[Side request from the project-compass pane. This is not the user speaking to you, and it is not part of the task. Do not use tools. Do not continue the work.]

From the conversation so far, assess the project the user is working on.

${work}${prior}Reply with ONE JSON object and nothing else, no prose and no code fence:
{
  "title": "the project's name, 2 to 5 words",
  "objective": "the project's overall objective, one sentence",
  "steps": [{ "text": "short imperative step", "status": "active" | "next" | "blocked" }],
  "risks": [{ "text": "one short line", "kind": "question" | "unknown" | "risk" }],
  "completion": 0-100
}

Rules:
- "steps": at most 3, most important first. Mark "active" the step being worked on right now (at most one), "blocked" one that waits on the user or an unknown.
- "risks": at most 3, the ones that matter most; leave out anything already resolved. "question": a decision or answer needed from the user. "unknown": something not yet known or verified. "risk": something that could go wrong and is not mitigated.
- "completion": your honest estimate of how much of the whole project (not just this session's task) is done, as an integer.
- Each text under 80 characters.`
}

const clean = (value: unknown, max = 160): string | null => {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()

  return text.length === 0 ? null : text.slice(0, max)
}

const sameText = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]+/g, '') === b.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Reads the fork's reply into a snapshot, or null when it holds no usable JSON
 * object. Items are marked against `previous`: `new` when it held no such text,
 * `changed` when a step's status moved.
 */
export const parseSnapshot = (
  reply: string,
  turn: number,
  updatedAt: number,
  previous: Snapshot | null = null,
): Snapshot | null => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object') return null

  const objective = clean(raw.objective, 240)
  if (objective === null) return null
  const title = clean(raw.title, 48) ?? 'Project'

  const steps: Step[] = (Array.isArray(raw.steps) ? raw.steps : [])
    .map((one: unknown): Step | null => {
      const item = (one ?? {}) as Record<string, unknown>
      const text = clean(typeof one === 'string' ? one : item.text)
      if (text === null) return null
      const status = STATUSES.includes(item.status as StepStatus) ? (item.status as StepStatus) : 'next'

      return { text, status }
    })
    .filter((one): one is Step => one !== null)
    .slice(0, 3)

  // At most one step reads as in progress.
  let hasActive = false
  for (const step of steps) {
    if (step.status !== 'active') continue
    if (hasActive) step.status = 'next'
    hasActive = true
  }

  const risks: Risk[] = (Array.isArray(raw.risks) ? raw.risks : [])
    .map((one: unknown): Risk | null => {
      const item = (one ?? {}) as Record<string, unknown>
      const text = clean(typeof one === 'string' ? one : item.text)
      if (text === null) return null
      const kind = KINDS.includes(item.kind as RiskKind) ? (item.kind as RiskKind) : 'risk'

      return { text, kind }
    })
    .filter((one): one is Risk => one !== null)
    .slice(0, 3)

  const number = Number(raw.completion)
  const completion = Number.isFinite(number) ? Math.round(Math.min(100, Math.max(0, number))) : 0

  if (previous !== null) {
    for (const step of steps) {
      const before = previous.steps.find(one => sameText(one.text, step.text))
      if (!before) step.change = 'new'
      else if (before.status !== step.status) step.change = 'changed'
    }
    for (const risk of risks) {
      if (!previous.risks.some(one => sameText(one.text, risk.text))) risk.change = 'new'
    }
  }

  return {
    title,
    objective,
    steps,
    risks,
    completion,
    turn,
    updatedAt,
    delta: previous === null ? null : completion - previous.completion,
    isObjectiveChanged: previous !== null && !sameText(previous.objective, objective),
  }
}

/** Reads a snapshot an earlier version of the mod saved, or null when it is not one. */
export const upgradeSnapshot = (value: unknown): Snapshot | null => {
  if (value === null || typeof value !== 'object') return null
  const old = value as Partial<Snapshot> & { risks?: unknown[] }
  if (typeof old.objective !== 'string' || !Array.isArray(old.steps)) return null

  return {
    title: typeof old.title === 'string' ? old.title : 'Project',
    objective: old.objective,
    steps: old.steps.map(({ text, status }) => ({ text, status })),
    risks: (old.risks ?? []).map(one =>
      typeof one === 'string' ? { text: one, kind: 'risk' as const } : { text: (one as Risk).text, kind: (one as Risk).kind },
    ),
    completion: typeof old.completion === 'number' ? old.completion : 0,
    turn: typeof old.turn === 'number' ? old.turn : 0,
    updatedAt: typeof old.updatedAt === 'number' ? old.updatedAt : 0,
    delta: null,
    isObjectiveChanged: false,
  }
}
