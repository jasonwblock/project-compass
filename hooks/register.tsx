import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Change, Plan, RiskKind, Snapshot, Step, StepStatus } from '../types'
import { buildPrompt, parseSnapshot, upgradeSnapshot } from './parse'
import { addUsage, dollars, priceOf } from './pricing'
import { fromTodos, stepsFromTasks, taskCreated, taskUpdated, workContext } from './work'

const PANE = 'project-compass'
const TITLE = 'Project compass'
/** How long a change since the assessment before stays marked. */
const FRESH_MS = 2 * 60_000
/** How often the pane redraws, so "updated 2m ago" and the change marks age. */
const TICK_MS = 15_000

const snapshot = atom({ plugin: 'project-compass', key: 'snapshot' } as const, null)
const isUpdating = atom({ plugin: 'project-compass', key: 'isUpdating' } as const, false)
const error = atom({ plugin: 'project-compass', key: 'error' } as const, null)
const tasks = atom({ plugin: 'project-compass', key: 'tasks' } as const, [])
const plan = atom({ plugin: 'project-compass', key: 'plan' } as const, null)
const isPlanning = atom({ plugin: 'project-compass', key: 'isPlanning' } as const, false)
const EMPTY_USAGE = { runs: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0 }
const projectUsage = atom({ plugin: 'project-compass', key: 'projectUsage' } as const, EMPTY_USAGE)
const usage = atom({ plugin: 'project-compass', key: 'usage' } as const, {
  runs: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  unpriced: 0,
})

const STEP_ICONS: Record<StepStatus, { icon: string; color: string }> = {
  active: { icon: '▶', color: 'claude' },
  next: { icon: '○', color: 'subtle' },
  blocked: { icon: '⏸', color: 'warning' },
}

const RISK_ICONS: Record<RiskKind, { icon: string; color: string }> = {
  question: { icon: '?', color: 'suggestion' },
  unknown: { icon: '…', color: 'permission' },
  risk: { icon: '⚠', color: 'warning' },
}

const storeKey = async ($: EngineInterface) => `snapshot:${await $.session.root()}`
const planKey = async ($: EngineInterface) => `plan:${await $.session.root()}`

/** A tool call that ran: neither refused nor answered with an error. */
const ran = (r: { deny?: string; isError?: boolean }) => !r.deny && !r.isError

const bar = (percent: number, width: number) => {
  const filled = Math.round((percent / 100) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const count = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

const ago = (then: number, now: number) => {
  if (then <= 0) return 'updated earlier'
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'updated just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `updated ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `updated ${hours}h ago`

  return `updated ${Math.floor(hours / 24)}d ago`
}

const costText = (cost: number, unpriced: number, runs: number) =>
  unpriced === runs ? 'API cost n/a' : `≈${dollars(cost)} API${unpriced > 0 ? ` (${unpriced} unpriced)` : ''}`

// Only the newest refresh may write; an older one that lands late is dropped.
let generation = 0
let ticker: Timer | undefined

async function refresh($: EngineInterface) {
  const mine = ++generation
  await update($, isUpdating, () => true)
  try {
    const previous = await read($, snapshot)
    // The fork runs on the main thread's model: price it at that model's rates.
    const model = await $.session.model()
    const work = workContext(await read($, isPlanning), await read($, plan), await read($, tasks))
    const reply = await $.model.fork({ prompt: buildPrompt(previous, work) })
    if ('usage' in reply && reply.usage) {
      const spent = reply.usage
      const cost = priceOf(model, spent)
      await update($, usage, sum => addUsage(sum, spent, cost))
    }
    if (mine !== generation) return
    if (!reply.isAnswered) {
      if (reply.reason !== 'nothing-to-fork' && reply.reason !== 'aborted') {
        await update($, error, () => `Update failed: ${reply.reason}`)
      }
      return
    }
    const next = parseSnapshot(reply.text, await $.session.turns(), await $.clock.now(), previous)
    if (next === null) {
      await update($, error, () => 'Update failed: the reply held no readable assessment')
      return
    }
    await update($, snapshot, () => next)
    await update($, error, () => null)
    await $.store.set(await storeKey($), next)
  } catch (err) {
    if (mine === generation) await update($, error, () => `Update failed: ${String(err)}`)
  } finally {
    if (mine === generation) await update($, isUpdating, () => false)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'compass',
      description: 'Open the project compass pane',
      argumentHint: '[refresh | reset]',
    })

    // What this session holds, or else what the last session in this project saved,
    // read through the upgrade so a snapshot an earlier version wrote still draws.
    const held = (await read($, snapshot)) ?? (await $.store.get(await storeKey($))) ?? null
    const current = upgradeSnapshot(held)
    await update($, snapshot, () => current)
    if ((await read($, plan)) === null) {
      const saved = (await $.store.get(await planKey($))) as Plan | undefined
      if (saved) await update($, plan, () => saved)
    }
    const isOldShape = held !== null && typeof (held as { title?: unknown }).title !== 'string'
    // Nothing yet, or an assessment with no title: assess now, not after the next turn.
    if ((current === null || isOldShape) && (await $.session.turns()) > 0) void refresh($)

    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    void $.ui.open({ id: PANE, title: TITLE })

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // The project's own spend: every turn, the main loop's and its subagents'.
    const used = e.usage
    if (used) await update($, projectUsage, sum => addUsage(sum, used, priceOf(used.model, used)))
    if (e.agentId === undefined && e.reason === 'answer') void refresh($)

    return done
  })

  // The hooks below only watch: if one fails, what is beneath stands (their `.catch`).
  // `next(e)` after the hook already called it replays that answer, so nothing runs twice.

  // Plan mode as the settings hooks see it: at each prompt (the mode the turn runs in) and as each turn stops.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.agent_id === undefined && e.permission_mode) await update($, isPlanning, () => e.permission_mode === 'plan')
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id === undefined && e.permission_mode) await update($, isPlanning, () => e.permission_mode === 'plan')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'EnterPlanMode' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && ran(r)) await update($, isPlanning, () => true)
    return r
  }).catch(($, e, next) => next(e))

  // An approved plan: what the next steps come from until it is replaced or reset.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || !ran(r)) return r
    await update($, isPlanning, () => false)
    const text = (r.result as { plan?: unknown } | undefined)?.plan
    if (typeof text === 'string' && text.trim() !== '') {
      const approved: Plan = { text, approvedAt: await $.clock.now() }
      await update($, plan, () => approved)
      await $.store.set(await planKey($), approved)
    }
    return r
  }).catch(($, e, next) => next(e))

  // The main loop's task list, in either form the session uses.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && ran(r)) {
      const now = await $.clock.now()
      await update($, tasks, list => fromTodos(e.todos, list, now))
    }
    return r
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    const created = (r.result as { task?: { id?: unknown } } | undefined)?.task
    if (e.agentId === undefined && ran(r) && typeof created?.id === 'string') {
      const id = created.id
      const now = await $.clock.now()
      await update($, tasks, list => taskCreated(list, { id, subject: e.subject, activeForm: e.activeForm }, now))
    }
    return r
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && ran(r)) {
      const now = await $.clock.now()
      await update($, tasks, list => taskUpdated(list, e, now))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'compass' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: TITLE })
    const arg = e.args.trim()
    if (arg === 'refresh') {
      void refresh($)
      return { text: 'Project compass: refreshing.' }
    }
    if (arg === 'reset') {
      generation += 1
      await update($, snapshot, () => null)
      await update($, error, () => null)
      await update($, isUpdating, () => false)
      await update($, plan, () => null)
      await $.store.delete(await storeKey($))
      await $.store.delete(await planKey($))
      return { text: 'Project compass: cleared. It reassesses after the next turn.' }
    }

    return { text: 'Project compass pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const shot = await read($, snapshot)
    const busy = await read($, isUpdating)
    const failed = await read($, error)
    const spent = await read($, usage)
    const projectSpent = await read($, projectUsage)
    const taskList = await read($, tasks)
    const approvedPlan = await read($, plan)
    const planning = await read($, isPlanning)
    const now = await $.clock.now()
    // One column of margin each side, inside the pane.
    const columns = Math.max(20, e.props.bodyColumns - 2)
    const isFresh = shot !== null && now - shot.updatedAt < FRESH_MS

    const divider = <Text dimColor>{'─'.repeat(columns)}</Text>
    const heading = (text: string) => <Text bold>{text.toUpperCase()}</Text>
    const badge = (change: Change | undefined) => (change ? <Text color="success">{` ◆ ${change}`}</Text> : null)
    const row = (icon: { icon: string; color: string }, text: string, change: Change | undefined, isBold = false) => (
      <Box>
        <Box width={3} flexShrink={0}>
          <Text color={icon.color}>{icon.icon}</Text>
        </Box>
        <Box flexShrink={1}>
          <Text bold={isBold}>{text}</Text>
        </Box>
        <Box flexShrink={0}>{badge(change)}</Box>
      </Box>
    )

    const statLine = (label: string, sum: typeof spent, unit: string) => (
      <Box>
        <Box width={9} flexShrink={0}>
          <Text bold>{label}</Text>
        </Box>
        <Box flexShrink={1}>
          <Text dimColor wrap="wrap">
            {sum.runs === 0
              ? 'none yet'
              : `↑${count(sum.input)} ↓${count(sum.output)}  cache ↑${count(sum.cacheRead)} ↓${count(sum.cacheWrite)}  ${sum.runs} ${unit}${sum.runs === 1 ? '' : 's'}  ${costText(sum.cost ?? 0, sum.unpriced ?? 0, sum.runs)}`}
          </Text>
        </Box>
      </Box>
    )
    const stats = (
      <Box flexDirection="column">
        {divider}
        {heading('Stats')}
        {statLine('Project', projectSpent, 'turn')}
        {statLine('Compass', spent, 'run')}
      </Box>
    )

    const footer = busy ? (
      <Text color="suggestion">↻ updating…</Text>
    ) : failed ? (
      <Text color="error">{failed}</Text>
    ) : shot ? (
      <Text dimColor>{`${ago(shot.updatedAt, now)} · turn ${shot.turn}`}</Text>
    ) : null

    if (shot === null) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor>No assessment yet. It appears after the next turn ends.</Text>
          {footer}
          {stats}
        </Box>
      )
    }

    const tone = shot.completion >= 75 ? 'success' : shot.completion >= 35 ? 'claude' : 'warning'
    const delta = isFresh && shot.delta ? shot.delta : 0
    const percent = `${shot.completion}%`
    const deltaText = delta > 0 ? ` ▲${delta}` : delta < 0 ? ` ▼${-delta}` : ''
    const barWidth = Math.max(6, Math.min(20, columns - shot.title.length - percent.length - deltaText.length - 3))

    // The task list, while it has open items, is the authority on what runs and what is next.
    const taskSteps = stepsFromTasks(taskList, now, FRESH_MS)
    const steps: Step[] = taskSteps ?? shot.steps
    const source = taskSteps ? 'from task list' : approvedPlan ? 'from approved plan' : null

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Box flexShrink={1}>
            <Text bold wrap="truncate-end">
              {shot.title}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={tone}>{bar(shot.completion, barWidth)}</Text>
            <Text bold>{` ${percent}`}</Text>
            {deltaText && <Text color={delta > 0 ? 'success' : 'error'}>{deltaText}</Text>}
          </Box>
        </Box>
        {divider}

        <Box>
          {heading('Objective')}
          {isFresh && shot.isObjectiveChanged && <Text color="success"> ◆ changed</Text>}
        </Box>
        <Text>{shot.objective}</Text>
        {divider}

        <Box>
          {heading('Next steps')}
          {planning && <Text color="planMode"> ◇ planning</Text>}
          {source && <Text dimColor>{` · ${source}`}</Text>}
        </Box>
        {steps.length === 0 && <Text dimColor>None identified.</Text>}
        {steps.map(step => row(STEP_ICONS[step.status], step.text, isFresh || taskSteps ? step.change : undefined, step.status === 'active'))}
        {divider}

        {heading('Questions & risks')}
        {shot.risks.length === 0 && <Text dimColor>None open.</Text>}
        {shot.risks.map(risk => row(RISK_ICONS[risk.kind], risk.text, isFresh ? risk.change : undefined))}
        {divider}

        {footer}
        {stats}
      </Box>
    )
  })
}
