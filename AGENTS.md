## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on MissingLinkDev/battle-board, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Commit messages

Always write the current commit message to `/tmp/battle-board-commit-message.txt`
and commit with `git commit -F /tmp/battle-board-commit-message.txt`. Reuse this
fixed filename so the command can be approved once for future commits.
