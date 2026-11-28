## Local development

With the `cmdz` executable installed, run `bun dev`, then open `https://gbfm.localhost`.
Cmdz starts Alchemy and the web app; Mobile, Email Preview, and Jaeger are
available as opt-in commands. Alchemy attaches to the externally managed web server rather
than starting a duplicate. Portless creates and trusts its local HTTPS certificate on first use.

`bun run dev:alchemy` runs the installed Alchemy version with local emulators and state in
`.alchemy/local-state/state/gbfm/dev`. Local dev accepts only the `dev` stage. It does not
read or reset the shared Cloudflare state store. Deployment commands still use remote state;
local startup does not repair unreadable deployment state.

For the October 2026 deployment-state failure and recovery, see the
[Alchemy incident retro](docs/operations/2026-10-24-alchemy-state-recovery.md).

## Current architecture

Dev & infra via [SST](https://sst.dev)

# Packages

### Frontend

- WWW uses Vite + native Effect UI. See [EFFECT-UI.md](EFFECT-UI.md) for runtime ownership and the unmerged, undeployed default-cutover boundary, and [Design System](docs/design-system.md) for visual guidance.
- Expo mobile, email templates, and social-image rendering retain React.

### Backend

- `packages/functions/api` defines & exposes routes
- I'm yet to explore cron & events

### Core business logic

- `packages/core` is where it's at.
  - For now, this just houses the logic for my spotify proxy

---

# Infra

- Infra folder defines all the SST constructs being used in the app
- Then all brought together in [sst config](sst.config.ts)

### DB strategy

- For the sake of progress, I think it's best to stick to Supabase for initial dev
- See if I can do my interfaces well enough, such that I can plug in different Postgres providers as I see fit.

### Auth strategy

- With the heading above in mind, it also makes sense to stick to the Lucia/Postgres setup for auth
- Again, seeking independence here & don't want to be reliant on proprietary tech for auth.
- Not yet, at least. I want to learn how the sausage is made before abstracting it away.

- [ ] How will I handle protected routes?
  - Potentially, it's just about getting the session id via request cookies & checking that exists in my session table?

### Transactional email

- [x] SES.

feat: release test
bump
bump
