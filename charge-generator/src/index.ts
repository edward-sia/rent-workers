import { requireBearer } from './auth';
import { generateCharges } from './charges';
import { notifyChargesDueSoon } from './due-reminders';

const MONTHLY_CHARGE_CRON = '0 0 15 * *';
const DAILY_DUE_REMINDER_CRON = '0 22 * * *';

export interface Env {
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
  DISCORD_WEBHOOK_URL: string;
  RUN_TOKEN: string;
}

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === DAILY_DUE_REMINDER_CRON) {
      ctx.waitUntil(notifyChargesDueSoon(env));
      return;
    }

    if (event.cron !== MONTHLY_CHARGE_CRON) {
      console.warn(`[scheduled] unexpected cron="${event.cron}", running monthly charge generation`);
    }

    ctx.waitUntil(generateCharges(env, new Date(event.scheduledTime)));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const denied = requireBearer(request, env.RUN_TOKEN);
      if (denied) return denied;

      await generateCharges(env);
      return new Response('Done — check Discord', { status: 200 });
    }
    return new Response('charge-generator is running', { status: 200 });
  },
};
