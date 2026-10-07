import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { readSettings, refreshLabel, shouldRefresh } from '../hooks/settings'

const SURFACES = ['terminal', 'desktop'] as const

const pane = (surface: (typeof SURFACES)[number]) =>
  ({
    plugin: 'project-compass',
    surface,
    component: 'Pane',
    requestId: 'project-compass',
    props: {
      title: 'Project compass',
      isFocused: false,
      bodyColumns: 70,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  }) as const

const REPLY = JSON.stringify({
  title: 'Compass Mod',
  objective: 'Build a Claude Code mod that tracks project progress.',
  steps: [
    { text: 'Write the parser', status: 'active' },
    { text: 'Ship 0.2.0', status: 'next' },
  ],
  risks: [{ text: 'Desktop drawing untested', kind: 'unknown' }],
  completion: 70,
})

const STATUS = JSON.stringify({ loggedIn: true, email: 'dev@example.com', subscriptionType: 'max' })

const TURN = { answer: 'done', durationMs: 10, isAborted: false, turnId: 't', reason: 'answer' } as const

/** The engine beneath the plugin, counting the forks and the CLI runs the plugin asks for. */
const engine = (on: On) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const calls = { forks: 0, runs: 0 }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'compass' } }) as never)
  const opens: unknown[] = []
  on('ui.open', ($, e) => {
    opens.push(e)
    return { value: { isPlaced: true } } as never
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.turns', () => ({ value: 1 }) as never)
  on('session.root', () => ({ value: '/work/project' }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 100_000, window: 1_000_000, percent: 10 }, rateLimits: [] } }) as never)
  on('process.run', () => {
    calls.runs += 1
    return { value: { exitCode: 0, stdout: STATUS, stderr: '' } } as never
  })
  on('model.fork', () => {
    calls.forks += 1
    return { value: { isAnswered: true, text: REPLY, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: 'a.ts' } }) as never)
  const start = async ($: { session: { start: (e: never) => Promise<unknown> } }) => {
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
  }
  const turn = async ($: { turn: { complete: (e: never) => Promise<unknown> } }, n: number) => {
    await $.turn.complete({ ...TURN, turnId: `t${n}` } as never)
    await clock.settle()
  }

  return { clock, calls, start, turn, opens }
}

describe('readSettings', () => {
  test('fills defaults and refuses values out of range', () => {
    expect(readSettings({})).toEqual({ refresh: 'turn', interval: 3, account: 'full' })
    expect(readSettings({ refresh: 'sometimes', refreshInterval: 0, account: 'loud' })).toEqual({ refresh: 'turn', interval: 3, account: 'full' })
    expect(readSettings({ refresh: 'interval', refreshInterval: 5, account: 'off' })).toEqual({ refresh: 'interval', interval: 5, account: 'off' })
  })

  test('decides each mode', () => {
    const at = (refresh: string, turns: number, isEdited: boolean) =>
      shouldRefresh(readSettings({ refresh, refreshInterval: 2 }), { turns, isEdited })
    expect([at('turn', 1, false), at('interval', 1, false), at('interval', 2, false)]).toEqual([true, false, true])
    expect([at('edits', 3, false), at('edits', 1, true), at('manual', 9, true)]).toEqual([false, true, false])
    expect(refreshLabel(readSettings({ refresh: 'interval', refreshInterval: 2 }))).toBe('refreshes every 2 turns')
  })
})

test('interval: one assessment every N turns', { options: { refresh: 'interval', refreshInterval: 2 } }, async ($, on) => {
  const { calls, turn } = engine(on)
  for (const n of [1, 2, 3, 4, 5]) await turn($, n)
  expect(calls.forks).toBe(2)
})

test('edits: only a turn that edited a file reassesses', { options: { refresh: 'edits' } }, async ($, on) => {
  const { calls, turn } = engine(on)
  await turn($, 1)
  expect(calls.forks).toBe(0)
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' } as never)
  await turn($, 2)
  expect(calls.forks).toBe(1)
  await turn($, 3)
  expect(calls.forks).toBe(1)
})

test('manual: no assessment until /compass refresh', { options: { refresh: 'manual' } }, async ($, on) => {
  const { calls, start, turn, clock } = engine(on)
  await start($)
  await turn($, 1)
  expect(calls.forks).toBe(0)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: 'No assessment yet. Run /compass refresh.' })).toBeDefined()
  await $.command.run({ command: 'compass', args: 'refresh' } as never)
  await clock.settle()
  expect(calls.forks).toBe(1)
  await ui.unmount()
})

test('account full: email and plan', async ($, on) => {
  const { start } = engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: 'dev@example.com · Max' })).toBeDefined()
  await ui.unmount()
})

test('account plan shows only the plan', { options: { account: 'plan' } }, async ($, on) => {
  const { start } = engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: 'Max plan' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dev@example\.com/ })).toBeUndefined()
  await ui.unmount()
})

test('account off never runs the CLI', { options: { account: 'off' } }, async ($, on) => {
  const { calls, start } = engine(on)
  await start($)
  expect(calls.runs).toBe(0)
})

test('the full pane draws on the desktop too', async ($, on) => {
  const { turn } = engine(on)
  await turn($, 1)
  const ui = await $.ui.mount(pane('desktop'))
  for (const text of ['Compass Mod', 'OBJECTIVE', 'NEXT STEPS', 'QUESTIONS & RISKS', 'STATS', 'Context Remaining', ' 90%']) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  await ui.unmount()
})
