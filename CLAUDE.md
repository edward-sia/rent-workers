# Claude Notes

Use the same repo conventions as `AGENTS.md`.

- Write code in TypeScript for this repo.
- Keep Airtable access in `packages/airtable-client` or existing worker modules that use it; do not add one-off Airtable fetch helpers.
- For `charge-generator`, read `charge-generator/AGENTS.md` before changing cron behavior, Discord notifications, or Wrangler config.
- For staging CI/CD, read `docs/staging-cicd.md` before changing GitHub Actions, Wrangler environments, or Cloudflare secrets.
- Update README and `docs/runbook.md` alongside behavior/config changes.
- Verify with `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and `npm run build:staging` when the change touches deployment config.
