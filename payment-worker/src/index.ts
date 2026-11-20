import { webhookCallback } from 'grammy';
import { createBot } from './bot';
import { requireWebhookSecret } from './auth';
import { WEBHOOK_TIMEOUT_MS } from './budget';
import { whatsappWebhook } from './whatsapp';
import type { Env } from './types';

export { ConfirmLock } from './confirm-lock';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/webhooks/whatsapp') return whatsappWebhook(request, env);
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
