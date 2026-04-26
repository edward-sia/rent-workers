// ─────────────────────────────────────────────────────────
// src/bot.ts
// grammy Telegram bot — 5-step payment wizard
//
// Flow:
//   /pay → select tenant → select charge →
//   enter amount → select method → select date → confirm → ✅
// ─────────────────────────────────────────────────────────

import { Bot, InlineKeyboard } from 'grammy';
import type { Env, WizardSession } from './types';
import { fetchAllRecords, createRecord } from './airtable';

// ── Table IDs (confirmed from Airtable schema) ────────────
const TENANCIES_TABLE = 'tblvVmo12VikITRH6';
const CHARGES_TABLE   = 'tblNCw6ZxspNxiKCu';
const PAYMENTS_TABLE  = 'tbl8Zl9C9fzBDPllu';

// ── KV session helpers (1hr TTL — expires stale wizards) ──
async function getSession(userId: number, kv: KVNamespace): Promise<WizardSession> {
  const raw = await kv.get(`session:${userId}`);
  return raw ? JSON.parse(raw) as WizardSession : { step: 'idle' };
}

async function setSession(userId: number, s: WizardSession, kv: KVNamespace): Promise<void> {
  await kv.put(`session:${userId}`, JSON.stringify(s), { expirationTtl: 3600 });
}

async function clearSession(userId: number, kv: KVNamespace): Promise<void> {
  await kv.delete(`session:${userId}`);
}

// ── Formatting helpers ────────────────────────────────────
const formatAUD = (n: number) =>
  `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const todayISO = () => new Date().toISOString().slice(0, 10);

const yesterdayISO = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// ── Confirmation card (always a fresh reply for clarity) ──
function confirmationText(s: WizardSession): string {
  const remaining = Math.max(0, (s.chargeBalance ?? 0) - (s.amount ?? 0));
  return (
    `📋 *Confirm Payment*\n\n` +
    `👤 *Tenant:*   ${s.tenancyLabel}\n` +
    `🧾 *Charge:*   ${s.chargeLabel}\n` +
    `💰 *Amount:*   ${formatAUD(s.amount ?? 0)}\n` +
    `💳 *Method:*   ${s.method}\n` +
    `📅 *Date:*     ${s.date}\n` +
    `📊 *Outstanding after:* ${formatAUD(remaining)}`
  );
}

// ── Bot factory — called fresh per CF Worker request ──────
export function createBot(env: Env): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // ── Auth guard ────────────────────────────────────────
  bot.use(async (ctx, next) => {
    if (String(ctx.from?.id) !== env.AUTHORIZED_USER_ID) {
      await ctx.reply('⛔ Unauthorised');
      return;
    }
    await next();
  });

  // ── /help ─────────────────────────────────────────────
  bot.command(['start', 'help'], async (ctx) => {
    await ctx.reply(
      `🏠 *New Haven Rent Bot*\n\n` +
      `/pay — Record a tenant payment\n` +
      `/cancel — Cancel current operation`,
      { parse_mode: 'Markdown' },
    );
  });

  // ── /cancel — escape hatch from any wizard step ───────
  bot.command('cancel', async (ctx) => {
    await clearSession(ctx.from!.id, env.SESSION_KV);
    await ctx.reply('❌ Cancelled. Use /pay to start again.');
  });

  // ── STEP 1: /pay — show active tenancies ──────────────
  bot.command('pay', async (ctx) => {
    await clearSession(ctx.from!.id, env.SESSION_KV);

    const tenancies = await fetchAllRecords(
      TENANCIES_TABLE,
      {
        fields:          ['Label', 'Balance'],
        filterByFormula: `OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()))`,
      },
      env,
    );

    if (!tenancies.length) {
      await ctx.reply('No active tenancies found.');
      return;
    }

    tenancies.sort((a, b) =>
      String(a.fields['Label']).localeCompare(String(b.fields['Label']))
    );

    const kb = new InlineKeyboard();
    for (const t of tenancies) {
      const label   = t.fields['Label'] as string;
      const balance = (t.fields['Balance'] as number) ?? 0;
      const tag     = balance > 0 ? ` 🔴 ${formatAUD(balance)}` : ' ✅';
      kb.text(`${label}${tag}`, `tenancy:${t.id}`).row();
    }

    await ctx.reply('💰 *Which tenant is paying?*', {
      parse_mode:   'Markdown',
      reply_markup: kb,
    });
  });

  // ── STEP 2: Tenancy selected → show outstanding charges ─
  bot.callbackQuery(/^tenancy:(.+)$/, async (ctx) => {
    const tenancyId = ctx.match[1];
    await ctx.answerCallbackQuery();

    // Resolve label for the selected tenancy
    const tenancyRec = await fetchAllRecords(
      TENANCIES_TABLE,
      {
        fields:          ['Label'],
        filterByFormula: `RECORD_ID() = "${tenancyId}"`,
      },
      env,
    );
    const tenancyLabel = tenancyRec[0]?.fields['Label'] as string ?? tenancyId;

    // Fetch all non-paid charges, filter by tenancy ID client-side
    // (Airtable formula on linked records compares primary field value,
    //  which is fragile with special chars — client filter is safer)
    const allCharges = await fetchAllRecords(
      CHARGES_TABLE,
      {
        fields:          ['Label', 'Balance', 'Status', 'Due Date', 'Tenancy'],
        filterByFormula: `NOT({Status} = "Paid")`,
      },
      env,
    );

    const charges = allCharges
      .filter(c => (c.fields['Tenancy'] as string[] | null)?.includes(tenancyId))
      .sort((a, b) =>
        String(a.fields['Due Date'] ?? '').localeCompare(String(b.fields['Due Date'] ?? ''))
      );

    if (!charges.length) {
      await ctx.editMessageText(
        `✅ *${tenancyLabel}* has no outstanding charges.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const kb = new InlineKeyboard();
    for (const c of charges) {
      const label   = c.fields['Label'] as string;
      const balance = (c.fields['Balance'] as number) ?? 0;
      const status  = c.fields['Status'] as string;
      const icon    = status === 'Overdue' ? '🔴' : status === 'Partial' ? '🟡' : '🟠';
      kb.text(`${icon} ${label} — ${formatAUD(balance)}`, `charge:${c.id}`).row();
    }
    kb.text('↩ Back', 'back:pay').row();

    await setSession(ctx.from!.id, {
      step: 'select_charge',
      tenancyId,
      tenancyLabel,
    }, env.SESSION_KV);

    await ctx.editMessageText(
      `💳 *${tenancyLabel}* — select charge to pay:`,
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  });

  // Back → re-trigger tenancy list
  bot.callbackQuery('back:pay', async (ctx) => {
    await ctx.answerCallbackQuery();
    await clearSession(ctx.from!.id, env.SESSION_KV);
    await ctx.editMessageText('Use /pay to start again.');
  });

  // ── STEP 3: Charge selected → ask for amount ──────────
  bot.callbackQuery(/^charge:(.+)$/, async (ctx) => {
    const chargeId = ctx.match[1];
    await ctx.answerCallbackQuery();

    const session = await getSession(ctx.from!.id, env.SESSION_KV);

    const chargeRecs = await fetchAllRecords(
      CHARGES_TABLE,
      {
        fields:          ['Label', 'Balance'],
        filterByFormula: `RECORD_ID() = "${chargeId}"`,
      },
      env,
    );
    const chargeLabel   = chargeRecs[0]?.fields['Label'] as string ?? chargeId;
    const chargeBalance = (chargeRecs[0]?.fields['Balance'] as number) ?? 0;

    await setSession(ctx.from!.id, {
      ...session,
      step: 'enter_amount',
      chargeId,
      chargeLabel,
      chargeBalance,
    }, env.SESSION_KV);

    await ctx.editMessageText(
      `💰 *${chargeLabel}*\n` +
      `Outstanding: *${formatAUD(chargeBalance)}*\n\n` +
      `Reply with the amount paid:`,
      { parse_mode: 'Markdown' },
    );
  });

  // ── STEP 4: Method selected → ask for date ────────────
  bot.callbackQuery(/^method:(.+)$/, async (ctx) => {
    const method = ctx.match[1];
    await ctx.answerCallbackQuery();

    const session = await getSession(ctx.from!.id, env.SESSION_KV);
    await setSession(ctx.from!.id, { ...session, step: 'select_date', method }, env.SESSION_KV);

    const today     = todayISO();
    const yesterday = yesterdayISO();

    const kb = new InlineKeyboard()
      .text(`Today (${today})`,           `date:${today}`).row()
      .text(`Yesterday (${yesterday})`,   `date:${yesterday}`).row()
      .text('✏️ Enter date manually',      'date:manual').row();

    await ctx.editMessageText(
      `Method: *${method}*\n\nPayment date?`,
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  });

  // ── STEP 5: Date selected via button ──────────────────
  bot.callbackQuery(/^date:(.+)$/, async (ctx) => {
    const value = ctx.match[1];
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

  // ── STEP 6: Confirm → write to Airtable ───────────────
  bot.callbackQuery('confirm:yes', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId  = ctx.from!.id;
    const session = await getSession(userId, env.SESSION_KV);

    if (!session.chargeId || !session.amount || !session.method || !session.date) {
      await ctx.editMessageText('❌ Session expired. Use /pay to start again.');
      await clearSession(userId, env.SESSION_KV);
      return;
    }

    try {
      // Label format: "Sun Peng 2026-04-25 $1,650.00"
      // Tenant name = everything after the first space-separated token in tenancyLabel
      // e.g. "6B-R6 Sun Peng" → "Sun Peng"
      const namePart = session.tenancyLabel?.split(' ').slice(1).join(' ')
                     ?? session.tenancyLabel
                     ?? '';
      const label = `${namePart} ${session.date} ${formatAUD(session.amount)}`;

      const record = await createRecord(
        PAYMENTS_TABLE,
        {
          'Label'    : label,
          'Charge'   : [session.chargeId],   // linked record — bare string ID
          'Amount'   : session.amount,
          'Paid Date': session.date,
          'Method'   : session.method,
          'Notes'    : `Recorded via payment-bot on ${new Date().toLocaleString()}`,
        },
        env,
      );

      const remaining  = Math.max(0, (session.chargeBalance ?? 0) - session.amount);
      const airtableUrl = `https://airtable.com/${env.AIRTABLE_BASE_ID}/${PAYMENTS_TABLE}/${record.id}`;

      await ctx.editMessageText(
        `✅ *Payment recorded!*\n\n` +
        `👤 ${session.tenancyLabel}\n` +
        `🧾 ${session.chargeLabel}\n` +
        `💰 ${formatAUD(session.amount)} — ${session.method}\n` +
        `📅 ${session.date}\n` +
        `📊 Charge outstanding after: *${formatAUD(remaining)}*\n\n` +
        `🔗 [View in Airtable](${airtableUrl})`,
        { parse_mode: 'Markdown' },
      );

      await clearSession(userId, env.SESSION_KV);
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[payment-bot] create failed: ${msg}`);
      await ctx.editMessageText(`❌ Failed to save payment:\n\`${msg}\``, {
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

  // ── Text message router — handles amount + manual date ─
  bot.on('message:text', async (ctx) => {
    const userId  = ctx.from!.id;
    const text    = ctx.message.text.trim();
    const session = await getSession(userId, env.SESSION_KV);

    // ── enter_amount ────────────────────────────────────
    if (session.step === 'enter_amount') {
      const amount = parseFloat(text.replace(/[$,]/g, ''));

      if (isNaN(amount) || amount <= 0) {
        await ctx.reply(
          '❌ Invalid amount. Enter a number like `1650` or `1650.00`',
          { parse_mode: 'Markdown' },
        );
        return;
      }

      await setSession(userId, { ...session, step: 'select_method', amount }, env.SESSION_KV);

      const kb = new InlineKeyboard()
        .text('💵 Cash',           'method:Cash')
        .text('🏦 Bank Transfer',  'method:Bank Transfer');

      await ctx.reply(
        `Amount: *${formatAUD(amount)}*\n\nHow was it paid?`,
        { parse_mode: 'Markdown', reply_markup: kb },
      );
      return;
    }

    // ── enter_date (manual) ─────────────────────────────
    if (session.step === 'enter_date') {
      let date: string | null = null;

      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        date = text;
      } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
        const [d, m, y] = text.split('/');
        date = `${y}-${m}-${d}`;
      }

      if (!date || isNaN(Date.parse(date))) {
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

    // ── idle / unknown ───────────────────────────────────
    await ctx.reply('Use /pay to record a payment, or /help for commands.');
  });

  return bot;
}

// ── Confirmation helper — always a fresh reply ────────────
async function sendConfirmation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  session: WizardSession,
): Promise<void> {
  const kb = new InlineKeyboard()
    .text('✅ Confirm', 'confirm:yes')
    .text('❌ Cancel',  'confirm:no');

  await ctx.reply(confirmationText(session), {
    parse_mode:   'Markdown',
    reply_markup: kb,
  });
}
