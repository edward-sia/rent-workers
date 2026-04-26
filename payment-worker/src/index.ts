// ─────────────────────────────────────────────────────────
// src/index.ts
// Cloudflare Worker entry point — payment-bot
// Receives Telegram webhook POSTs, passes to grammy bot
// ─────────────────────────────────────────────────────────

import { webhookCallback } from 'grammy';
import { createBot }       from './bot';
import type { Env }        from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Bot is created fresh per request — CF Workers are stateless.
    // Session state lives in KV, not in-memory.
    const bot     = createBot(env);
    const handler = webhookCallback(bot, 'cloudflare-mod');
    return handler(request);
  },
};
