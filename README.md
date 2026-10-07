# Project Compass

A Claude Code mod: a side pane that keeps track of where your project stands. After each turn, a side request to the model (a fork of the conversation, with no tools) reassesses the project, and the pane shows:

- **Header**: the project's name and an estimated completion bar, with how far it moved since the last assessment
- **Objective**: the project's goal, in one sentence
- **Next steps** (up to 3): `▶` in progress, `○` next, `⏸` blocked
- **Questions & risks** (up to 3): `?` a question for you, `…` an unknown, `⚠` an unmitigated risk
- **Stats**: tokens and approximate API list-price cost, for the project's own turns and for the compass's forks

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

Each assessment adds one model call per turn. It mostly reads from the prompt cache, and the Stats section shows what it costs.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
