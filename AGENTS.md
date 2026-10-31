- run `bun precommit` to validate your changes. this gives you typecheck, oxlint, and oxfmt
- work in the `prod` branch unless otherwise specified
- when changing the Foldkit WWW app, read `FOLDKIT.md` and check the installed framework version before using upstream examples
- after mobile changes, build and install the verified latest version on the user's physical iPhone before calling the work done; simulator checks alone are not the handoff

## Agent skills

### Pull requests

Use the `pr-description` skill when creating or updating PR descriptions. For UI changes verified in a browser, use the `pr-screenshot-evidence` skill to embed real screenshots in a `Test evidence` section of the PR description. Keep screenshots out of git and use disposable fixtures without real user data or secrets.

### Issue tracker

Issues are tracked on GitHub. See `docs/agents/issue-tracker.md`.

### Triage labels

The standard five-role triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.

### Drizzle queries

Relational-query rules and the generated-SQL test strategy. See `docs/agents/drizzle-queries.md`.
