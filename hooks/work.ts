import type { Plan, Step, Task, TaskStatus } from '../types'

export type Todo = { content: string; status: TaskStatus; activeForm?: string }

/** A TodoWrite list replaces the whole list: items keep their times when their text matches one before. */
export const fromTodos = (todos: readonly Todo[], previous: readonly Task[], now: number): Task[] =>
  todos.map((todo, index) => {
    const before = previous.find(one => one.subject === todo.content)

    return {
      id: before?.id ?? `todo-${index}-${now}`,
      subject: todo.content,
      activeForm: todo.activeForm,
      status: todo.status,
      blockedBy: [],
      createdAt: before?.createdAt ?? now,
      changedAt: before && before.status === todo.status ? before.changedAt : now,
    }
  })

export const taskCreated = (
  tasks: readonly Task[],
  task: { id: string; subject: string; activeForm?: string },
  now: number,
): Task[] => [
  ...tasks.filter(one => one.id !== task.id),
  { id: task.id, subject: task.subject, activeForm: task.activeForm, status: 'pending', blockedBy: [], createdAt: now, changedAt: now },
]

export type TaskChange = {
  taskId: string
  subject?: string
  activeForm?: string
  status?: TaskStatus | 'deleted'
  addBlockedBy?: string[]
}

export const taskUpdated = (tasks: readonly Task[], change: TaskChange, now: number): Task[] => {
  const moved = change.status
  if (moved === 'deleted') return tasks.filter(one => one.id !== change.taskId)

  return tasks.map(one => {
    if (one.id !== change.taskId) return one
    const status = moved ?? one.status

    return {
      ...one,
      subject: change.subject ?? one.subject,
      activeForm: change.activeForm ?? one.activeForm,
      status,
      blockedBy: [...one.blockedBy, ...(change.addBlockedBy ?? [])],
      changedAt: status === one.status ? one.changedAt : now,
    }
  })
}

/**
 * The pane's next steps from the task list: what runs first, then what can
 * start, then what waits on another task; null when nothing is left open.
 */
export const stepsFromTasks = (tasks: readonly Task[], now: number, freshMs: number): Step[] | null => {
  const isOpen = (id: string) => tasks.some(one => one.id === id && one.status !== 'completed')
  const open = tasks.filter(one => one.status !== 'completed')
  if (open.length === 0) return null

  const rank = (task: Task) =>
    task.status === 'in_progress' ? 0 : task.blockedBy.some(isOpen) ? 2 : 1
  const ordered = [...open].sort((a, b) => rank(a) - rank(b))

  return ordered.slice(0, 3).map(task => {
    const isRunning = task.status === 'in_progress'
    const step: Step = {
      text: isRunning ? (task.activeForm ?? task.subject) : task.subject,
      status: isRunning ? 'active' : task.blockedBy.some(isOpen) ? 'blocked' : 'next',
    }
    if (now - task.createdAt < freshMs) step.change = 'new'
    else if (now - task.changedAt < freshMs) step.change = 'changed'

    return step
  })
}

const PLAN_LIMIT = 8_000

/** What the fork is told about planning, the approved plan and the task list. */
export const workContext = (isPlanning: boolean, plan: Plan | null, tasks: readonly Task[]): string => {
  const parts: string[] = []
  if (isPlanning) {
    parts.push(
      'The session is in plan mode: the user and the assistant are designing a plan, and nothing is being implemented yet. "steps" are what the plan proposes; mark one "active" only when planning itself is the work under way.',
    )
  }
  if (plan) {
    const text = plan.text.length > PLAN_LIMIT ? `${plan.text.slice(0, PLAN_LIMIT)}\n[…plan cut]` : plan.text
    parts.push(
      `The user approved this plan. Take "steps" from it, in its order, leaving out what is already done:\n<plan>\n${text}\n</plan>`,
    )
  }
  if (tasks.length > 0) {
    const lines = tasks.map(task => `- [${task.status}] ${task.subject}`).join('\n')
    parts.push(`The assistant's task list right now, the authority on what is done and what is under way:\n${lines}`)
  }

  return parts.length === 0 ? '' : `${parts.join('\n\n')}\n\n`
}
