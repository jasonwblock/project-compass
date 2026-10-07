# Project Compass

A Claude Code mod: a side pane that keeps track of where your project stands. After each turn, a side request to the model (a fork of the conversation, with no tools) reassesses the project, and the pane shows:

- **Header**: the project's name, the account you're signed in with, and an estimated completion bar with how far it moved since the last assessment
- **Objective**: the project's goal, in one sentence
- **Next steps** (up to 3): `▶` in progress, `○` next, `⏸` blocked
- **Questions & risks** (up to 3): `?` a question for you, `…` an unknown, `⚠` an unmitigated risk
- **Stats**:
  - **Context Remaining**: how much of the context window is free (green, yellow under 60%, red under 30%)
  - **Project**: tokens and approximate API list-price cost of the session's own turns
  - **Compass**: the same for the compass's assessments

New and changed items are marked `◆` for two minutes after an assessment.

It follows how you work:

- **Task list**: when Claude keeps a task list, the next steps come straight from it (the in-progress task, then what can start, then what's blocked).
- **Plan mode**: while you plan, the pane shows `◇ planning`. When you approve a plan, the next steps follow it, and the plan is remembered for the project.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install project-compass --marketplace jasonwblock/project-compass
```

Answer `y` to add the marketplace, then pick the user scope.

## Use

- The pane opens by itself on a terminal at least 144 columns wide; otherwise type `/compass`.
- `/compass refresh` reassesses now; `/compass reset` clears the saved assessment and plan for the project.
- Collapse the pane to its header and current step with the `−` button (or `c` while the pane has focus), or `/compass collapse` and `/compass expand`. It stays the way you leave it.

## Settings

Set in `/config`, or under `pluginConfigs` in your settings:

| Setting | Values | Default |
| --- | --- | --- |
| **Refresh** (`refresh`) | `turn`: after every turn · `interval`: every few turns · `edits`: after a turn that edited files · `manual`: only on `/compass refresh` | `turn` |
| **Refresh interval** (`refreshInterval`) | turns between assessments when Refresh is `interval` | `3` |
| **Account line** (`account`) | `full`: email and plan · `plan`: the plan alone · `off`: no line | `full` |

Each assessment is one model call. It mostly reads from the prompt cache, and the Stats section shows what it costs; `interval`, `edits` or `manual` cut that down on long sessions.

The account line comes from `claude auth status`, run locally once per session; with `off` it is never run.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
