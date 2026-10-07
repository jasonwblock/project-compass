import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fromTodos, stepsFromTasks, taskCreated, taskUpdated } from '../hooks/work'

const PANE = {
  plugin: 'project-compass',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'project-compass',
  props: {
    title: 'Project compass',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const REPLY = JSON.stringify({
  title: 'Compass Mod',
  objective: 'Build a Claude Code mod that tracks project progress.',
  steps: [{ text: 'A step the fork chose', status: 'next' }],
  risks: [],
  completion: 50,
})

const TURN = { answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as const

const engine = (on: On) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const prompts: string[] = []
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.turns', () => ({ value: 2 }) as never)
  on('session.root', () => ({ value: '/work/project' }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('model.fork', ($, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: REPLY, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })

  return { clock, prompts }
}

describe('the task list', () => {
  const T0 = 0
  const LATER = 10 * 60_000

  test('orders what runs, then what can start, then what waits', () => {
    let list = taskCreated([], { id: '1', subject: 'Write parser' }, T0)
    list = taskCreated(list, { id: '2', subject: 'Write tests' }, T0)
    list = taskCreated(list, { id: '3', subject: 'Ship it' }, T0)
    list = taskCreated(list, { id: '4', subject: 'Write docs' }, T0)
    list = taskUpdated(list, { taskId: '3', addBlockedBy: ['2'] }, T0)
    list = taskUpdated(list, { taskId: '2', status: 'in_progress', activeForm: 'Writing tests' }, T0)
    list = taskUpdated(list, { taskId: '1', status: 'completed' }, T0)

    const steps = stepsFromTasks(list, LATER, 60_000)
    expect(steps?.map(step => [step.status, step.text])).toEqual([
      ['active', 'Writing tests'],
      ['next', 'Write docs'],
      ['blocked', 'Ship it'],
    ])
  })

  test('marks a task new, then changed, then neither', () => {
    let list = taskCreated([], { id: '1', subject: 'Write parser' }, T0)
    expect(stepsFromTasks(list, T0 + 1_000, 60_000)?.[0]?.change).toBe('new')
    list = taskUpdated(list, { taskId: '1', status: 'in_progress' }, LATER)
    expect(stepsFromTasks(list, LATER + 1_000, 60_000)?.[0]?.change).toBe('changed')
    expect(stepsFromTasks(list, LATER + 120_000, 60_000)?.[0]?.change).toBe(undefined)
  })

  test('has no steps once everything is done or deleted', () => {
    let list = taskCreated([], { id: '1', subject: 'Write parser' }, T0)
    list = taskCreated(list, { id: '2', subject: 'Drop me' }, T0)
    list = taskUpdated(list, { taskId: '1', status: 'completed' }, T0)
    list = taskUpdated(list, { taskId: '2', status: 'deleted' }, T0)
    expect(list.length).toBe(1)
    expect(stepsFromTasks(list, T0, 60_000)).toBe(null)
  })

  test('a rewritten todo list keeps the times of items it still holds', () => {
    const first = fromTodos([{ content: 'A', status: 'pending', activeForm: 'Doing A' }], [], T0)
    const second = fromTodos(
      [
        { content: 'A', status: 'pending', activeForm: 'Doing A' },
        { content: 'B', status: 'pending', activeForm: 'Doing B' },
      ],
      first,
      LATER,
    )
    expect(second.map(task => task.createdAt)).toEqual([T0, LATER])
    expect(second[0]?.id).toBe(first[0]?.id)
  })
})

test('the task list drives the next steps, over what the fork chose', async ($, on) => {
  const { clock } = engine(on)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
  const ui = await $.ui.mount(PANE)

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Write the parser', status: 'in_progress', activeForm: 'Writing the parser' },
      { content: 'Add tests', status: 'pending', activeForm: 'Adding tests' },
    ],
  })
  await $.turn.complete(TURN)
  await clock.settle()

  expect(await ui.find({ type: 'Text', text: ' · from task list' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Writing the parser' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Add tests' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'A step the fork chose' })).toBeUndefined()
  await ui.unmount()
})

test('plan mode shows the planning tag, and an approved plan reaches the fork', async ($, on) => {
  const { clock, prompts } = engine(on)
  on('classic.UserPromptSubmit', () => ({}) as never)
  on('tool.call', { tool: 'ExitPlanMode' }, () => ({ result: { plan: '1. Build the thing\n2. Test the thing', isAgent: false } }) as never)
  const ui = await $.ui.mount(PANE)

  await $.classic.UserPromptSubmit({ prompt: 'plan it', permission_mode: 'plan' } as never)
  await $.turn.complete(TURN)
  await clock.settle()
  expect(prompts[0]).toContain('The session is in plan mode')
  expect(await ui.find({ type: 'Text', text: ' ◇ planning' })).toBeDefined()

  await $.tool.call({ tool: 'ExitPlanMode' })
  await $.turn.complete({ ...TURN, turnId: 't2' })
  await clock.settle()
  expect(prompts[1]).toContain('The user approved this plan')
  expect(prompts[1]).toContain('2. Test the thing')
  expect(prompts[1]).not.toContain('The session is in plan mode')
  expect(await ui.find({ type: 'Text', text: ' ◇ planning' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ' · from approved plan' })).toBeDefined()
  await ui.unmount()
})

test('a rejected plan is not kept', async ($, on) => {
  const { clock, prompts } = engine(on)
  on('tool.call', { tool: 'ExitPlanMode' }, () => ({ deny: 'The user rejected the plan' }))

  await $.tool.call({ tool: 'ExitPlanMode' })
  await $.turn.complete(TURN)
  await clock.settle()
  expect(prompts[0]).not.toContain('The user approved this plan')
})
