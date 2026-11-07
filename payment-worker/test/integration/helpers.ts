import { SELF, env, fetchMock } from 'cloudflare:test';
import type { Env } from '../../src/types';

export const AIRTABLE_ORIGIN = 'https://api.airtable.com';
export const TELEGRAM_ORIGIN = 'https://api.telegram.org';
export const SECRET = 'a'.repeat(32);
export const USER_ID = 1234;
export const TENANCIES = 'tblvVmo12VikITRH6';
export const CHARGES = 'tblNCw6ZxspNxiKCu';
export const PAYMENTS = 'tbl8Zl9C9fzBDPllu';
export const TENANTS = 'tblsesIqj1VuokNcP';
export const ROOMS = 'tblBrzawaTuwahBQg';
export const testEnv = env as unknown as Env;

export interface MockReplyOptions {
  body?: unknown;
  path?: string;
}

export function telegramUpdate(body: object): Promise<Response> {
  return SELF.fetch('https://worker.test/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': SECRET,
    },
    body: JSON.stringify(body),
  });
}

export function messageUpdate(updateId: number, text: string, userId = USER_ID): object {
  const commandLength = text.startsWith('/') ? text.split(/\s/, 1)[0]?.length ?? text.length : 0;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: userId, type: 'private' },
      from: { id: userId, is_bot: false, first_name: 'Operator' },
      text,
      ...(commandLength > 0
        ? { entities: [{ offset: 0, length: commandLength, type: 'bot_command' }] }
        : {}),
    },
  };
}

export function callbackUpdate(updateId: number, data: string): object {
  return {
    update_id: updateId,
    callback_query: {
      id: `cq-${updateId}`,
      chat_instance: 'ci',
      from: { id: USER_ID, is_bot: false, first_name: 'Operator' },
      message: {
        message_id: updateId,
        date: 0,
        chat: { id: USER_ID, type: 'private' },
      },
      data,
    },
  };
}

export function parseBody(body: unknown): any {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return Object.fromEntries(new URLSearchParams(body));
    }
  }
  if (body instanceof ArrayBuffer) return parseBody(new TextDecoder().decode(body));
  if (body instanceof Uint8Array) return parseBody(new TextDecoder().decode(body));
  throw new Error(`Unexpected mock body: ${String(body)}`);
}

export function stubTelegram(times = 20): any[] {
  const payloads: any[] = [];
  fetchMock
    .get(TELEGRAM_ORIGIN)
    .intercept({ path: /.*/, method: 'POST' })
    .reply((opts: MockReplyOptions) => {
      payloads.push(parseBody(opts.body));
      return { statusCode: 200, data: { ok: true, result: {} } };
    })
    .times(times);
  return payloads;
}

/** Callback data of every inline button in the given Telegram payloads. */
export function buttonData(payloads: any[]): string[] {
  return payloads.flatMap((payload) => {
    const markup = typeof payload.reply_markup === 'string'
      ? JSON.parse(payload.reply_markup)
      : payload.reply_markup;
    const rows: { callback_data?: string }[][] = markup?.inline_keyboard ?? [];
    return rows.flat().flatMap((button) => (button.callback_data ? [button.callback_data] : []));
  });
}

/** Everything a `console.error` spy was called with, one call per line. */
export function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
}
