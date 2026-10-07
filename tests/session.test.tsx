import { describe, expect, mock, test } from 'claude-code/testing'

import { contextTone, parseAccount } from '../hooks/session'

const PANE = {
  plugin: 'project-compass',
  surface: 'terminal',
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
} as const

const STATUS = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'dev@example.com', subscriptionType: 'max' })

describe('parseAccount', () => {
  test('reads the email and names the plan', () => {
    expect(parseAccount(STATUS)).toEqual({ email: 'dev@example.com', plan: 'Max' })
  })

  test('is null when signed out or unreadable', () => {
    expect(parseAccount(JSON.stringify({ loggedIn: false }))).toBe(null)
    expect(parseAccount('not json')).toBe(null)
  })
})

describe('contextTone', () => {
  test('green with room, yellow under 60%, red under 30%', () => {
    expect([100, 60, 59, 30, 29, 0].map(contextTone)).toEqual(['success', 'success', 'warning', 'warning', 'error', 'error'])
  })
})

test('the pane shows the account under the title and the context left in STATS', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'compass' } }) as never)
  on('ui.open', () => ({ value: {} }) as never)
  on('session.turns', () => ({ value: 0 }) as never)
  on('session.root', () => ({ value: '/work/project' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: STATUS, stderr: '' } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 750_000, window: 1_000_000, percent: 75 }, rateLimits: [] } }) as never)

  await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ type: 'Text', text: 'dev@example.com · Max' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Context Remaining' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 25%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  250k of 1M' })).toBeDefined()
  await ui.unmount()
})

test('before the first response the context line says it is not known', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }) as never)
  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ type: 'Text', text: 'not known yet' })).toBeDefined()
  await ui.unmount()
})
