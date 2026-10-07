# Changelog

## 0.2.1

- Removed collapsing: Claude Code keeps the side panel's width, so the pane could not narrow itself to a rail. The `−` button and `/compass collapse` / `/compass expand` are gone.

## 0.2.0

- Header shows the signed-in account under the project name (setting: **Account line**: `full`, `plan` or `off`).
- Stats opens with **Context Remaining**: a bar of the free context window, yellow under 60% and red under 30%.
- New **Refresh** setting: reassess after every turn, every few turns, only after turns that edited files, or only on `/compass refresh`. The footer says which.
- The pane collapses to its header and current step (`−` button, `c`, or `/compass collapse` / `/compass expand`), and remembers it.
- Tested on the desktop app's surface as well as the terminal.

## 0.1.0

- First release: objective, completion, next steps (from the task list or an approved plan when there is one), questions and risks, and token and cost stats.
