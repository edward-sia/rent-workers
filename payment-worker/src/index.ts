import { webhookCallback } from 'grammy';
import { createBot } from './bot';
import { requireWebhookSecret } from './auth';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('payment-bot is running', { status: 200 });
    }

    const denied = requireWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET);
    if (denied) return denied;

    const bot = createBot(env);
    const handler = webhookCallback(bot, 'cloudflare-mod');
    return handler(request);
  },
};
