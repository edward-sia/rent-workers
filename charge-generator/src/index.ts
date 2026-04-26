import { requireBearer } from './auth';
import { generateCharges, getNextChargePeriod } from './charges';
import type { ChargeGenerationLock } from './lock';

export { ChargeGenerationLock } from './lock';

export interface Env {
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
  DISCORD_WEBHOOK_URL: string;
  RUN_TOKEN: string;
  CHARGE_GENERATION_LOCK: DurableObjectNamespace<ChargeGenerationLock>;
}

type ChargeGenerationRunResult =
  | { status: 'ran'; period: string }
  | { status: 'skipped'; period: string; activeRunId?: string };

async function runChargeGeneration(env: Env): Promise<ChargeGenerationRunResult> {
  const chargePeriod = getNextChargePeriod();
  const runId = crypto.randomUUID();
  const lockNamespace = env.CHARGE_GENERATION_LOCK;
  const lock = typeof lockNamespace.getByName === 'function'
    ? lockNamespace.getByName(chargePeriod.period)
    : lockNamespace.get(lockNamespace.idFromName(chargePeriod.period));
  const claim = await lock.claim(chargePeriod.period, runId);

  if (!claim.acquired) {
    console.log(
      `[${chargePeriod.period}] charge generation already running; activeRunId=${claim.activeRunId ?? 'unknown'}`,
    );
    return {
      status: 'skipped',
      period: chargePeriod.period,
      activeRunId: claim.activeRunId,
    };
  }

  try {
    await generateCharges(env, chargePeriod);
    return { status: 'ran', period: chargePeriod.period };
  } finally {
    await lock.release(runId);
  }
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runChargeGeneration(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const denied = requireBearer(request, env.RUN_TOKEN);
      if (denied) return denied;

      const result = await runChargeGeneration(env);
      if (result.status === 'skipped') {
        return new Response(`Skipped — charge generation already running for ${result.period}`, {
          status: 202,
        });
      }
      return new Response('Done — check Discord', { status: 200 });
    }
    return new Response('charge-generator is running', { status: 200 });
  },
};
