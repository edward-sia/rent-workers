import { AirtableClient, ChargeSchema, PaymentSchema, TABLES, TenancySchema } from '@rent/airtable-client';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import {
  escapeTelegramMarkdown,
  escapeTelegramMarkdownUrl,
  formatAUD,
  parseAmount,
  parseDate,
  todayISO,
  yesterdayISO,
} from './format';
import { clearSession, getSession, setSession } from './session';
import type { Env, WizardSession } from './types';

const METHOD_CASH = 'Cash';
const METHOD_BANK_TRANSFER = 'Bank Transfer';
const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: 'Payment Bot',
  username: 'payment_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  can_manage_bots: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
} as const;

function confirmationText(session: WizardSession): string {
  const remaining = Math.max(0, (session.chargeBalance ?? 0) - (session.amount ?? 0));
  return (
    `📋 *Confirm Payment*\n\n` +
    `👤 *Tenant:*   ${escapeTelegramMarkdown(String(session.tenancyLabel))}\n` +
    `🧾 *Charge:*   ${escapeTelegramMarkdown(String(session.chargeLabel))}\n` +
    `💰 *Amount:*   ${escapeTelegramMarkdown(formatAUD(session.amount ?? 0))}\n` +
    `💳 *Method:*   ${escapeTelegramMarkdown(String(session.method))}\n` +
    `📅 *Date:*     ${escapeTelegramMarkdown(String(session.date))}\n` +
    `📊 *Outstanding after:* ${escapeTelegramMarkdown(formatAUD(remaining))}`
  );
}

export function createBot(env: Env): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, {
    botInfo: BOT_INFO,
    client: { fetch },
  });
  const airtable = new AirtableClient(env);

  bot.use(async (ctx, next) => {
    if (String(ctx.from?.id) !== env.AUTHORIZED_USER_ID) {
      await ctx.reply('⛔ Unauthorised');
      return;
    }
    await next();
  });

  bot.command(['start', 'help'], async (ctx) => {
    await ctx.reply(
      `🏠 *New Haven Rent Bot*\n\n` +
      `/pay — Record a tenant payment\n` +
      `/cancel — Cancel current operation`,
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('cancel', async (ctx) => {
    await clearSession(ctx.from!.id, env.SESSION_KV);
    await ctx.reply('❌ Cancelled. Use /pay to start again.');
  });

  bot.command('pay', async (ctx) => {
    await clearSession(ctx.from!.id, env.SESSION_KV);

    const tenancies = await airtable.fetchAll(
      TABLES.TENANCIES,
      TenancySchema,
      {
        fields: ['Label', 'Balance'],
        filterByFormula: 'OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()))',
      },
    );

    if (tenancies.length === 0) {
      await ctx.reply('No active tenancies found.');
      return;
    }

    tenancies.sort((a, b) => a.fields.Label.localeCompare(b.fields.Label));

    const keyboard = new InlineKeyboard();
    for (const tenancy of tenancies) {
      const balance = tenancy.fields.Balance ?? 0;
      const tag = balance > 0 ? ` 🔴 ${formatAUD(balance)}` : ' ✅';
      keyboard.text(`${tenancy.fields.Label}${tag}`, `tenancy:${tenancy.id}`).row();
    }

    await ctx.reply('💰 *Which tenant is paying?*', {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^tenancy:(.+)$/, async (ctx) => {
    const tenancyId = ctx.match[1];
    if (!tenancyId) return;
    await ctx.answerCallbackQuery();

    const tenancyRecords = await airtable.fetchAll(
      TABLES.TENANCIES,
      TenancySchema,
      {
        fields: ['Label'],
        filterByFormula: `RECORD_ID() = "${tenancyId}"`,
      },
    );
    const tenancyLabel = tenancyRecords[0]?.fields.Label ?? tenancyId;

    const allCharges = await airtable.fetchAll(
      TABLES.CHARGES,
      ChargeSchema,
      {
        fields: ['Label', 'Balance', 'Status', 'Due Date', 'Tenancy'],
        filterByFormula: 'NOT({Status} = "Paid")',
      },
    );

    const charges = allCharges
      .filter(charge => charge.fields.Tenancy?.includes(tenancyId))
      .sort((a, b) => String(a.fields['Due Date'] ?? '').localeCompare(String(b.fields['Due Date'] ?? '')));

    if (charges.length === 0) {
      await ctx.editMessageText(
        `✅ *${escapeTelegramMarkdown(tenancyLabel)}* has no outstanding charges.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const charge of charges) {
      const balance = charge.fields.Balance ?? 0;
      const status = charge.fields.Status;
      const icon = status === 'Overdue' ? '🔴' : status === 'Partial' ? '🟡' : '🟠';
      keyboard.text(`${icon} ${charge.fields.Label} — ${formatAUD(balance)}`, `charge:${charge.id}`).row();
    }
    keyboard.text('↩ Back', 'back:pay').row();

    await setSession(ctx.from!.id, {
      step: 'select_charge',
      tenancyId,
      tenancyLabel,
    }, env.SESSION_KV);

    await ctx.editMessageText(
      `💳 *${escapeTelegramMarkdown(tenancyLabel)}* — select charge to pay:`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  });

  bot.callbackQuery('back:pay', async (ctx) => {
    await ctx.answerCallbackQuery();
    await clearSession(ctx.from!.id, env.SESSION_KV);
    await ctx.editMessageText('Use /pay to start again.');
  });

  bot.callbackQuery(/^charge:(.+)$/, async (ctx) => {
    const chargeId = ctx.match[1];
    if (!chargeId) return;
    await ctx.answerCallbackQuery();

    const session = await getSession(ctx.from!.id, env.SESSION_KV);
    const chargeRecords = await airtable.fetchAll(
      TABLES.CHARGES,
      ChargeSchema,
      {
        fields: ['Label', 'Balance'],
        filterByFormula: `RECORD_ID() = "${chargeId}"`,
      },
    );
    const chargeLabel = chargeRecords[0]?.fields.Label ?? chargeId;
    const chargeBalance = chargeRecords[0]?.fields.Balance ?? 0;

    await setSession(ctx.from!.id, {
      ...session,
      step: 'enter_amount',
      chargeId,
      chargeLabel,
      chargeBalance,
    }, env.SESSION_KV);

    await ctx.editMessageText(
      `💰 *${escapeTelegramMarkdown(chargeLabel)}*\n` +
      `Outstanding: *${escapeTelegramMarkdown(formatAUD(chargeBalance))}*\n\n` +
      'Reply with the amount paid:',
      { parse_mode: 'Markdown' },
    );
  });

  bot.callbackQuery(/^method:(.+)$/, async (ctx) => {
    const method = ctx.match[1];
    if (!method) return;
    await ctx.answerCallbackQuery();

    const session = await getSession(ctx.from!.id, env.SESSION_KV);
    await setSession(ctx.from!.id, { ...session, step: 'select_date', method }, env.SESSION_KV);

    const today = todayISO();
    const yesterday = yesterdayISO();
    const keyboard = new InlineKeyboard()
      .text(`Today (${today})`, `date:${today}`).row()
      .text(`Yesterday (${yesterday})`, `date:${yesterday}`).row()
      .text('✏️ Enter date manually', 'date:manual').row();

    await ctx.editMessageText(
      `Method: *${escapeTelegramMarkdown(method)}*\n\nPayment date?`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  });

  bot.callbackQuery(/^date:(.+)$/, async (ctx) => {
    const value = ctx.match[1];
    if (!value) return;
    await ctx.answerCallbackQuery();

    const session = await getSession(ctx.from!.id, env.SESSION_KV);
    if (value === 'manual') {
      await setSession(ctx.from!.id, { ...session, step: 'enter_date' }, env.SESSION_KV);
      await ctx.editMessageText(
        'Enter date in `YYYY-MM-DD` or `DD/MM/YYYY` format:',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const updated = { ...session, step: 'confirm' as const, date: value };
    await setSession(ctx.from!.id, updated, env.SESSION_KV);
    await sendConfirmation(ctx, updated);
  });

  bot.callbackQuery('confirm:yes', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;
    const session = await getSession(userId, env.SESSION_KV);

    if (!session.chargeId || !session.amount || !session.method || !session.date) {
      await ctx.editMessageText('❌ Session expired. Use /pay to start again.');
      await clearSession(userId, env.SESSION_KV);
      return;
    }

    try {
      const namePart = session.tenancyLabel?.split(' ').slice(1).join(' ')
        ?? session.tenancyLabel
        ?? '';
      const label = `${namePart} ${session.date} ${formatAUD(session.amount)}`;

      const record = await airtable.create(
        TABLES.PAYMENTS,
        PaymentSchema,
        {
          Label: label,
          Charge: [session.chargeId],
          Amount: session.amount,
          'Paid Date': session.date,
          Method: session.method,
          Notes: `Recorded via payment-bot on ${new Date().toLocaleString()}`,
        },
      );

      const remaining = Math.max(0, (session.chargeBalance ?? 0) - session.amount);
      const airtableUrl = `https://airtable.com/${env.AIRTABLE_BASE_ID}/${TABLES.PAYMENTS}/${record.id}`;

      await ctx.editMessageText(
        `✅ *Payment recorded!*\n\n` +
        `👤 ${escapeTelegramMarkdown(String(session.tenancyLabel))}\n` +
        `🧾 ${escapeTelegramMarkdown(String(session.chargeLabel))}\n` +
        `💰 ${escapeTelegramMarkdown(formatAUD(session.amount))} — ${escapeTelegramMarkdown(session.method)}\n` +
        `📅 ${escapeTelegramMarkdown(session.date)}\n` +
        `📊 Charge outstanding after: *${escapeTelegramMarkdown(formatAUD(remaining))}*\n\n` +
        `🔗 [View in Airtable](${escapeTelegramMarkdownUrl(airtableUrl)})`,
        { parse_mode: 'Markdown' },
      );

      await clearSession(userId, env.SESSION_KV);
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[payment-bot] create failed: ${msg}`);
      await ctx.editMessageText(`❌ Failed to save payment:\n\`${escapeTelegramMarkdown(msg)}\``, {
        parse_mode: 'Markdown',
      });
      await clearSession(userId, env.SESSION_KV);
    }
  });

  bot.callbackQuery('confirm:no', async (ctx) => {
    await ctx.answerCallbackQuery();
    await clearSession(ctx.from!.id, env.SESSION_KV);
    await ctx.editMessageText('❌ Cancelled. Use /pay to start again.');
  });

  bot.on('message:text', async (ctx) => {
    const userId = ctx.from!.id;
    const text = ctx.message.text.trim();
    const session = await getSession(userId, env.SESSION_KV);

    if (session.step === 'enter_amount') {
      const amount = parseAmount(text);
      if (amount === null) {
        await ctx.reply(
          '❌ Invalid amount. Enter a number like `1650` or `1650.00`',
          { parse_mode: 'Markdown' },
        );
        return;
      }

      await setSession(userId, { ...session, step: 'select_method', amount }, env.SESSION_KV);
      const keyboard = new InlineKeyboard()
        .text('💵 Cash', `method:${METHOD_CASH}`)
        .text('🏦 Bank Transfer', `method:${METHOD_BANK_TRANSFER}`);

      await ctx.reply(
        `Amount: *${escapeTelegramMarkdown(formatAUD(amount))}*\n\nHow was it paid?`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
      return;
    }

    if (session.step === 'enter_date') {
      const date = parseDate(text);
      if (!date) {
        await ctx.reply(
          '❌ Invalid date. Use `YYYY-MM-DD` or `DD/MM/YYYY`',
          { parse_mode: 'Markdown' },
        );
        return;
      }

      const updated = { ...session, step: 'confirm' as const, date };
      await setSession(userId, updated, env.SESSION_KV);
      await sendConfirmation(ctx, updated);
      return;
    }

    await ctx.reply('Use /pay to record a payment, or /help for commands.');
  });

  return bot;
}

async function sendConfirmation(
  ctx: Context,
  session: WizardSession,
): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text('✅ Confirm', 'confirm:yes')
    .text('❌ Cancel', 'confirm:no');

  await ctx.reply(confirmationText(session), {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}
