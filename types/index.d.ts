export type StepStatus = 'active' | 'next' | 'blocked'

export type RiskKind = 'question' | 'unknown' | 'risk'

/** `change` says how an item differs from the assessment before it, when it does. */
export type Change = 'new' | 'changed'

export type Step = { text: string; status: StepStatus; change?: Change }

export type Risk = { text: string; kind: RiskKind; change?: Change }

export type Snapshot = {
  title: string
  objective: string
  steps: Step[]
  risks: Risk[]
  completion: number
  turn: number
  /** When the assessment landed, in ms since the epoch. */
  updatedAt: number
  /** Completion's move since the assessment before, null for the first. */
  delta: number | null
  isObjectiveChanged: boolean
}

/** Tokens and their API list-price cost, summed over runs (the mod's forks) or turns (the project's). */
export type Usage = {
  runs: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** API list-price equivalent of the priced runs, in US dollars. */
  cost: number
  /** Runs on a model with no known price, left out of `cost`. */
  unpriced: number
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** One item of the main loop's task list (TodoWrite, or TaskCreate and TaskUpdate). */
export type Task = {
  id: string
  subject: string
  /** The present-tense label shown while it runs ("Writing tests"). */
  activeForm?: string
  status: TaskStatus
  /** Ids of tasks that must finish first. */
  blockedBy: string[]
  createdAt: number
  /** When its status last moved. */
  changedAt: number
}

/** Who the session is signed in as, from `claude auth status`. */
export type Account = { email: string; plan?: string }

/** The plan the person approved when the session left plan mode. */
export type Plan = { text: string; approvedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'project-compass': {
      snapshot: Snapshot | null
      isUpdating: boolean
      error: string | null
      usage: Usage
      projectUsage: Usage
      tasks: Task[]
      plan: Plan | null
      isPlanning: boolean
      account: Account | null
    }
  }
}
