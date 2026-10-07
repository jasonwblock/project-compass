import type { PluginOptions } from 'claude-code'

/** turn: after every turn. interval: every N turns. edits: after a turn that edited files. manual: on /compass refresh alone. */
export type RefreshMode = 'turn' | 'interval' | 'edits' | 'manual'

/** full: email and plan. plan: the plan alone. off: no line, and the CLI is never asked. */
export type AccountMode = 'full' | 'plan' | 'off'

export type Settings = { refresh: RefreshMode; interval: number; account: AccountMode }

const REFRESH: readonly RefreshMode[] = ['turn', 'interval', 'edits', 'manual']
const ACCOUNT: readonly AccountMode[] = ['full', 'plan', 'off']

/** The manifest's userConfig values, with anything missing or out of range at its default. */
export const readSettings = (options: PluginOptions): Settings => {
  const refresh = REFRESH.includes(options.refresh as RefreshMode) ? (options.refresh as RefreshMode) : 'turn'
  const account = ACCOUNT.includes(options.account as AccountMode) ? (options.account as AccountMode) : 'full'
  const asked = Number(options.refreshInterval)
  const interval = Number.isFinite(asked) && asked >= 1 ? Math.round(asked) : 3

  return { refresh, interval, account }
}

/** What has happened since the last assessment. */
export type SinceRefresh = { turns: number; isEdited: boolean }

/** Whether a finished turn should reassess, under the chosen mode. */
export const shouldRefresh = (settings: Settings, since: SinceRefresh): boolean => {
  switch (settings.refresh) {
    case 'turn':
      return true
    case 'interval':
      return since.turns >= settings.interval
    case 'edits':
      return since.isEdited
    case 'manual':
      return false
  }
}

/** The footer's few words on when the next assessment comes. */
export const refreshLabel = (settings: Settings): string => {
  switch (settings.refresh) {
    case 'turn':
      return 'refreshes every turn'
    case 'interval':
      return `refreshes every ${settings.interval} turns`
    case 'edits':
      return 'refreshes after edits'
    case 'manual':
      return 'refresh with /compass refresh'
  }
}

/** The tools whose success counts as an edit for the `edits` mode. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
