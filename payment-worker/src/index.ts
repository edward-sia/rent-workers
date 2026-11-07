import { webhookCallback } from 'grammy';
import { createBot } from './bot';
import { requireWebhookSecret } from './auth';
import type { Env } from './types';

/**
 * How long grammY waits for a handler before it gives up. Its default is 10 s, which a
 * move-in Confirm against a slow Airtable can pass. Giving up mid-save leaves the session
 * at `saving` with some writes done.
 */
const WEBHOOK_TIMEOUT_MS = 50_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'payment-bot',
      });
    }

    if (request.method !== 'POST') {
      return new Response('payment-bot is running', { status: 200 });
    }

    const denied = requireWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET);
    if (denied) return denied;

    const bot = createBot(env);
    const handler = webhookCallback(bot, 'cloudflare-mod', { timeoutMilliseconds: WEBHOOK_TIMEOUT_MS });
    return handler(request);
  },
};
