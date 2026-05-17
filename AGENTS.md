# rent-workers Agent Notes

This is a TypeScript Cloudflare Workers monorepo. Prefer repo-root checks before claiming changes are done:

```bash
npm run typecheck
npm run test
npm run build
```

`charge-generator` owns scheduled rent charge creation and Discord notifications. Its worker-specific guidance lives in `charge-generator/AGENTS.md`.

`payment-worker` owns the Telegram payment-recording webhook.

When behavior, configuration, secrets, commands, file layout, or operations change, update the relevant README plus `docs/runbook.md` in the same change. Keep `CLAUDE.md` aligned with this file when adding agent-facing instructions.
