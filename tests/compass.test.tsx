import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseSnapshot, upgradeSnapshot } from '../hooks/parse'
import { dollars, priceOf } from '../hooks/pricing'

const PANE = {
  plugin: 'project-compass',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'project-compass',
  props: {
    title: 'Project compass',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const FIRST = JSON.stringify({
  title: 'Compass Mod',
  objective: 'Build a Claude Code mod that tracks project progress.',
  steps: [
    { text: 'Write the pane renderer', status: 'active' },
    { text: 'Add tests', status: 'active' },
    { text: 'Publish to a marketplace', status: 'next' },
    { text: 'A fourth step that is dropped', status: 'next' },
  ],
  risks: [
    { text: 'Where should it be published?', kind: 'question' },
    { text: 'Fork cost per turn is unmeasured', kind: 'unknown' },
    'A bare string risk',
  ],
  completion: 40,
})

const SECOND = JSON.stringify({
  title: 'Compass Mod',
  objective: 'Build a Claude Code mod that tracks project progress.',
  steps: [
    { text: 'Add tests', status: 'active' },
    { text: 'Write a README', status: 'next' },
  ],
  risks: [{ text: 'Fork cost per turn is unmeasured', kind: 'unknown' }],
  completion: 55,
})

const TURN = {
  answer: 'done',
  durationMs: 10,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  usage: { model: 'claude-opus-5-5', input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0 },
} as const

const USAGE = { input_tokens: 120, output_tokens: 80, cache_read_input_tokens: 45_000, cache_creation_input_tokens: 2_000 }

/** The engine beneath the plugin: a fork answering each reply in turn, a session, a clock and a store. */
const engine = (on: On, replies: string[]) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const prompts: string[] = []
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.turns', () => ({ value: 3 }) as never)
  on('session.root', () => ({ value: '/work/project' }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('model.fork', ($, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: replies.shift() ?? '', usage: USAGE } } as never
  })

  return { clock, prompts }
}

describe('parseSnapshot', () => {
  test('keeps three steps, one active, and reads risk kinds', () => {
    const shot = parseSnapshot(`Here you go:\n${FIRST}`, 4, 99)
    expect(shot?.title).toBe('Compass Mod')
    expect(shot?.steps.map(step => step.status)).toEqual(['active', 'next', 'next'])
    expect(shot?.risks.map(risk => risk.kind)).toEqual(['question', 'unknown', 'risk'])
    expect(shot?.updatedAt).toBe(99)
    expect(shot?.delta).toBe(null)
  })

  test('marks what changed since the previous assessment', () => {
    const first = parseSnapshot(FIRST, 1, 0)
    const second = parseSnapshot(SECOND, 2, 0, first)
    expect(second?.steps.map(step => step.change)).toEqual(['changed', 'new'])
    expect(second?.risks.map(risk => risk.change)).toEqual([undefined])
    expect(second?.delta).toBe(15)
    expect(second?.isObjectiveChanged).toBe(false)
  })

  test('refuses a reply with no objective or no JSON', () => {
    expect(parseSnapshot('no json here', 1, 0)).toBe(null)
    expect(parseSnapshot('{"steps": []}', 1, 0)).toBe(null)
  })

  test('upgrades a snapshot the first version saved', () => {
    const old = { objective: 'Old goal', steps: [{ text: 'Step', status: 'next' }], risks: ['A risk'], completion: 30, turn: 2 }
    const shot = upgradeSnapshot(old)
    expect(shot?.title).toBe('Project')
    expect(shot?.risks).toEqual([{ text: 'A risk', kind: 'risk' }])
  })
})

describe('priceOf', () => {
  const used = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }

  test('prices each model family at its own rates', () => {
    // input + output + cache read + 1.25x input for the cache write
    expect(priceOf('claude-opus-5-5', used)).toBe(4 + 20 + 0.2 + 5)
    expect(priceOf('claude-opus-5-5[1m]', used)).toBe(4 + 20 + 0.2 + 5)
    expect(priceOf('claude-opus-4-8', used)).toBe(5 + 25 + 0.5 + 6.25)
    expect(priceOf('claude-fable-5-1', used)).toBe(10 + 50 + 0.25 + 12.5)
    expect(priceOf('claude-sonnet-5-5', used)).toBe(2 + 10 + 0.2 + 2.5)
    expect(priceOf('claude-haiku-4-5', used)).toBe(1 + 5 + 0.1 + 1.25)
    expect(priceOf('some-other-model', used)).toBe(null)
  })

  test('formats small costs with enough digits to read', () => {
    expect(dollars(0.00231)).toBe('$0.0023')
    expect(dollars(0.0231)).toBe('$0.023')
    expect(dollars(2.5)).toBe('$2.50')
  })
})

test('a finished main-loop turn fills the pane', async ($, on) => {
  const { clock, prompts } = engine(on, [FIRST])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /No assessment yet/ })).toBeDefined()

  await $.turn.complete(TURN)
  await clock.settle()

  expect(prompts[0]).toContain('project-compass')
  expect(await ui.find({ type: 'Text', text: 'Compass Mod' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 40%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'NEXT STEPS' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'QUESTIONS & RISKS' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '?' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '…' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'STATS' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Compass' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↑120 ↓80  cache ↑45.0k ↓2.0k  1 run  ≈$0.021 API' })).toBeDefined()
  // The project line: the turn's own usage, priced at its model's rates.
  expect(await ui.find({ type: 'Text', text: 'Project' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↑1.0k ↓500  cache ↑20.0k ↓0  1 turn  ≈$0.018 API' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'updated just now · turn 3' })).toBeDefined()
  await ui.unmount()
})

test('a second assessment marks its changes, and the marks fade', async ($, on) => {
  const { clock } = engine(on, [FIRST, SECOND])
  const ui = await $.ui.mount(PANE)

  await $.turn.complete(TURN)
  await clock.settle()
  await $.turn.complete({ ...TURN, turnId: 't2' })
  await clock.settle()

  expect(await ui.find({ type: 'Text', text: ' ▲15' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' ◆ new' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' ◆ changed' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 runs/ })).toBeDefined()

  await clock.advance(3 * 60_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: ' ◆ new' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ' ▲15' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'updated 3m ago · turn 3' })).toBeDefined()
  await ui.unmount()
})

test("a subagent's turn does not refresh", async ($, on) => {
  const { clock, prompts } = engine(on, [FIRST])

  await $.turn.complete({ ...TURN, agentId: 'sub-1' })
  await clock.settle()

  expect(prompts.length).toBe(0)
})
