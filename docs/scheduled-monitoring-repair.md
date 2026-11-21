# Worker scheduled-job monitoring repair

Prepared without deployment. The Worker currently catches scheduled-job failures
before Sentry's outer scheduled-handler instrumentation can see them.

This change preserves existing job dispatch, catch/log behavior, and service
results. It reports reminder and maintenance task failures through the existing
Sentry service before recovery swallows them. Sitemap generation additionally
reuses the existing `sitemap-regeneration` cron monitor, with the Worker's actual
`0 * * * *` UTC schedule. Failed or interrupted work cannot report an OK check-in.
Disabled or defective telemetry does not stop the job.

No automatic cron integration is enabled and no reminder/maintenance cron monitor
is created. The owner declined additional paid monitors.

## Deployment gate

No infrastructure, production data, billing settings, or deployed Worker was changed.
Before deployment, confirm the existing cron slot and monitor environment.
The retired Bun runtime last checked in under `production` in August; the current
Worker's Sentry environment is `prod`. Do not delete historical environments or
activate additional billed monitors implicitly. Confirm the environment/quota
transition as part of the owner's deployment approval.

After deployment, verify a real hourly start/finish pair in Sentry, failures in
the shared Oracle issue path, and the absence of duplicate cron monitors.
Success/error/interruption and telemetry-failure behavior are covered through
the Sentry service seam, without network calls or SDK module mocks.

Missed reminder or maintenance executions still need a separate heartbeat design;
exception capture alone cannot detect work that never ran.
