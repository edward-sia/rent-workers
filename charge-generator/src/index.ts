import { requireBearer } from './auth';
import { generateCharges } from './charges';

export interface Env {
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
  DISCORD_WEBHOOK_URL: string;
  RUN_TOKEN: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(generateCharges(env));
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
