# Claude Notes

Use the same repo conventions as `AGENTS.md`.

- Write code in TypeScript for this repo.
- Keep Airtable access in `packages/airtable-client` or existing worker modules that use it; do not add one-off Airtable fetch helpers.
- For `charge-generator`, read `charge-generator/AGENTS.md` before changing cron behavior, Discord notifications, or Wrangler config.
- Update README and `docs/runbook.md` alongside behavior/config changes.
- Verify with `npm run typecheck`, `npm run test`, and `npm run build` when the change touches Worker code.
