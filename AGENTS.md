# rent-workers Agent Notes

This is a TypeScript Cloudflare Workers monorepo. Prefer repo-root checks before claiming changes are done:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Use `npm run build:staging` after changing Wrangler environments or staging CI/CD.
Use `npm run build:production` after changing production deploy workflows or top-level Wrangler production config.

`charge-generator` owns scheduled rent charge creation and Discord notifications. Its worker-specific guidance lives in `charge-generator/AGENTS.md`.

`payment-worker` owns the Telegram payment-recording webhook, the `/pay` wizard, the read-only due-date-sorted `/reminder` outstanding-payment summary, and its staging KV binding. Its worker-specific guidance lives in `payment-worker/AGENTS.md`.

When behavior, configuration, secrets, commands, file layout, or operations change, update the relevant README plus `docs/runbook.md` in the same change. Keep `CLAUDE.md` aligned with this file when adding agent-facing instructions.
