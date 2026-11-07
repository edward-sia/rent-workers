import {
  AirtableClient,
  type AirtableRecord,
  type Charge,
  ChargeSchema,
  RoomSchema,
  TABLES,
  TenancySchema,
} from '@rent/airtable-client';
import { chargesAfter, checkEndDate, endOfMonthISO, owedThrough } from '@rent/tenancy';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import {
  escapeTelegramMarkdown as esc,
  escapeTelegramMarkdownUrl,
  formatAUD,
  httpStatusOf,
  melbourneDateISO,
  parseDate,
} from './format';
import { clearSession, getSession, setSession } from './session';
import type { Env, SessionChoice, WizardSession } from './types';

interface ReplyOptions {
  parse_mode?: 'Markdown';
  reply_markup?: InlineKeyboard;
}

const EXPIRED = '⚠️ This move-out was already saved or has expired. Use /moveout to start again.';

function logFailure(error: unknown): void {
  console.error(`[payment-bot] moveout failed: ${error instanceof Error ? error.message : String(error)}`);
}

/** Edit the tapped message for button presses, reply for typed text. */
async function respond(ctx: Context, text: string, options: ReplyOptions = {}): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, options);
  } else {
    await ctx.reply(text, options);
  }
}

function link(env: Env, tableId: string, recordId: string, label: string): string {
  const url = `https://airtable.com/${env.AIRTABLE_BASE_ID}/${tableId}/${recordId}`;
  return `[${label}](${escapeTelegramMarkdownUrl(url)})`;
}

function dateKeyboard(today: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(`Today (${today})`, 'mo:d:today').row()
    .text(`End of this month (${endOfMonthISO(today)})`, 'mo:d:eom').row()
    .text('✏️ Enter date', 'mo:d:manual').row();
}

function roomLine(session: WizardSession, today: string): string {
  const code = esc(String(session.roomCode));
  if (!session.roomId) return `🚪 No room is linked, so no room status changes.`;
  if (String(session.endDate) <= today) return `🚪 Room ${code} will be marked *Vacant*.`;
  return `🚪 Room ${code} stays *Occupied* until the end date.`;
}

function confirmText(
  env: Env,
  session: WizardSession,
  charges: AirtableRecord<Charge>[],
  today: string,
): string {
  const endDate = String(session.endDate);
  const later = chargesAfter(charges, endDate);
  let text =
    `📋 *Confirm Move-Out*\n\n` +
    `👤 *Tenant:* ${esc(String(session.tenancyLabel))}\n` +
    `🚪 *Room:* ${esc(String(session.roomCode))}\n` +
    `📅 *End date:* ${esc(endDate)}\n` +
    `💰 *Owed through end date:* ${esc(formatAUD(owedThrough(charges, endDate)))}\n` +
    roomLine(session, today);

  if (later.length > 0) {
    text += `\n\n⚠️ *Charges due after the end date:*\n`;
    for (const charge of later) {
      text +=
        `• ${esc(charge.fields.Label)} — due ${esc(String(charge.fields['Due Date']))} — ` +
        `${esc(String(charge.fields.Status ?? 'no status'))} — ${link(env, TABLES.CHARGES, charge.id, 'Open')}\n`;
    }
    text += `Fix these in Airtable.`;
  }
  return text;
}

/** Check the end date, read this tenancy's charges once, and show the confirm screen. */
async function showConfirm(
  ctx: Context,
  env: Env,
  session: WizardSession,
  endDate: string,
): Promise<void> {
  const today = melbourneDateISO();
  const problem = checkEndDate(endDate, session.startDate);
  if (problem) {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(`❌ ${problem}\n\nPick the end date:`, { reply_markup: dateKeyboard(today) });
    } else {
      await ctx.reply(`❌ ${problem}\n\nEnter the end date again:`);
    }
    return;
  }

  const userId = ctx.from!.id;
  let charges: AirtableRecord<Charge>[];
  try {
    const all = await new AirtableClient(env).fetchAll(TABLES.CHARGES, ChargeSchema, {
      fields: ['Label', 'Balance', 'Status', 'Due Date', 'Tenancy'],
      filterByFormula: `OR(NOT({Status} = "Paid"), IS_AFTER({Due Date}, "${endDate}"))`,
    });
    charges = all.filter((charge) => charge.fields.Tenancy?.includes(String(session.tenancyId)));
  } catch (e) {
    logFailure(e);
    await clearSession(userId, env.SESSION_KV);
    await respond(ctx, 'Failed to load charges. Check Worker logs, then use /moveout to try again.');
    return;
  }

  const updated: WizardSession = { ...session, flow: 'moveout', step: 'mo_confirm', endDate };
  await setSession(userId, updated, env.SESSION_KV);
  await respond(ctx, confirmText(env, updated, charges, today), {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard().text('✅ Confirm', 'mo:confirm').text('❌ Cancel', 'mo:cancel'),
  });
}

async function saveMoveOut(ctx: Context, env: Env, session: WizardSession): Promise<void> {
  const userId = ctx.from!.id;
  const airtable = new AirtableClient(env);
  const tenancyId = String(session.tenancyId);
  const endDate = String(session.endDate);
  const label = esc(String(session.tenancyLabel));
  const code = esc(String(session.roomCode));

  try {
    await airtable.update(TABLES.TENANCIES, TenancySchema, tenancyId, { 'End Date': endDate });
  } catch (e) {
    logFailure(e);
    await clearSession(userId, env.SESSION_KV);
    await ctx.editMessageText(
      `❌ Move-out not saved: ${httpStatusOf(e)}. Nothing was changed. Check Worker logs.`,
    );
    return;
  }

  const lines = [`✅ *Move-out saved*`, '', `👤 ${label}`, `📅 End date: ${esc(endDate)}`];
  if (session.roomId && endDate <= melbourneDateISO()) {
    try {
      await airtable.update(TABLES.ROOMS, RoomSchema, session.roomId, { Status: 'Vacant' });
      lines.push(`🚪 Room ${code} marked *Vacant*.`);
    } catch (e) {
      logFailure(e);
      lines[0] = `⚠️ *End date saved, but the room was not updated*`;
      lines.push(`🚪 Room status update failed: ${httpStatusOf(e)}. Set ${code} to *Vacant* in Airtable.`);
    }
  } else if (session.roomId) {
    lines.push(`🚪 Room ${code} stays *Occupied*. Set it to Vacant in Airtable after the tenant leaves.`);
  } else {
    lines.push('🚪 No room is linked, so no room status changed.');
  }

  lines.push('', `🔗 ${link(env, TABLES.TENANCIES, tenancyId, 'Tenancy in Airtable')}`);
  if (session.roomId) lines.push(`🔗 ${link(env, TABLES.ROOMS, session.roomId, 'Room in Airtable')}`);
  const handover = session.roomId
    ? new InlineKeyboard().text(`Start new tenant in ${String(session.roomCode)}`, `mi:r:${session.roomId}`)
    : undefined;

  await clearSession(userId, env.SESSION_KV);
  await ctx.editMessageText(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: handover });
}

export function registerMoveOut(bot: Bot, env: Env): void {
  bot.command('moveout', async (ctx) => {
    const userId = ctx.from!.id;
    await clearSession(userId, env.SESSION_KV);

    let tenancies;
    try {
      tenancies = await new AirtableClient(env).fetchAll(TABLES.TENANCIES, TenancySchema, {
        fields: ['Label', 'Balance', 'Start Date', 'End Date', 'Room'],
        filterByFormula: 'OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()))',
      });
    } catch (e) {
      logFailure(e);
      await ctx.reply('Failed to load tenancies. Check Worker logs.');
      return;
    }

    if (tenancies.length === 0) {
      await ctx.reply('No active tenancies found.');
      return;
    }

    tenancies.sort((a, b) => a.fields.Label.localeCompare(b.fields.Label));
    const keyboard = new InlineKeyboard();
    const choices: Record<string, SessionChoice> = {};
    for (const tenancy of tenancies) {
      const { Label, Balance = 0, 'Start Date': startDate, 'End Date': endDate, Room } = tenancy.fields;
      const tag = Balance > 0 ? ` 🔴 ${formatAUD(Balance)}` : ' ✅';
      const ends = endDate ? ` · ends ${endDate}` : '';
      keyboard.text(`${Label}${tag}${ends}`, `mo:t:${tenancy.id}`).row();
      choices[tenancy.id] = { label: Label, startDate, roomId: Room?.[0] };
    }

    await setSession(userId, { flow: 'moveout', step: 'idle', choices }, env.SESSION_KV);
    await ctx.reply('🚪 *Who is moving out?*', { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.callbackQuery(/^mo:t:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const session = await getSession(userId, env.SESSION_KV);
    const choice = session.flow === 'moveout' ? session.choices?.[ctx.match[1] ?? ''] : undefined;
    if (!choice) {
      await ctx.editMessageText(EXPIRED);
      return;
    }

    await setSession(userId, {
      flow: 'moveout',
      step: 'mo_select_date',
      tenancyId: ctx.match[1],
      tenancyLabel: choice.label,
      startDate: choice.startDate,
      roomId: choice.roomId,
      roomCode: choice.label.split(' ')[0],
    }, env.SESSION_KV);

    await ctx.editMessageText(
      `📅 *${esc(choice.label)}* — when does the tenancy end?`,
      { parse_mode: 'Markdown', reply_markup: dateKeyboard(melbourneDateISO()) },
    );
  });

  bot.callbackQuery(/^mo:d:(today|eom|manual)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const session = await getSession(userId, env.SESSION_KV);
    if (session.flow !== 'moveout' || session.step !== 'mo_select_date') {
      await ctx.editMessageText(EXPIRED);
      return;
    }

    const today = melbourneDateISO();
    if (ctx.match[1] === 'manual') {
      await setSession(userId, { ...session, step: 'mo_enter_date' }, env.SESSION_KV);
      await ctx.editMessageText('Enter the end date in `YYYY-MM-DD` or `DD/MM/YYYY` format:', {
        parse_mode: 'Markdown',
      });
      return;
    }

    await showConfirm(ctx, env, session, ctx.match[1] === 'eom' ? endOfMonthISO(today) : today);
  });

  bot.callbackQuery('mo:confirm', async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = await getSession(ctx.from.id, env.SESSION_KV);
    if (session.flow !== 'moveout' || session.step !== 'mo_confirm' || !session.tenancyId || !session.endDate) {
      await ctx.editMessageText(EXPIRED);
      return;
    }

    // KV is the double-tap guard: a second Confirm finds `saving` and writes nothing.
    await setSession(ctx.from.id, { ...session, step: 'saving' }, env.SESSION_KV);
    await saveMoveOut(ctx, env, session);
  });

  bot.callbackQuery('mo:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = await getSession(ctx.from.id, env.SESSION_KV);
    if (session.step === 'saving') {
      await ctx.editMessageText(EXPIRED);
      return;
    }
    if (session.flow === 'moveout') await clearSession(ctx.from.id, env.SESSION_KV);
    await ctx.editMessageText('❌ Move-out cancelled. Nothing was changed.');
  });
}

/** Handles typed text for the move-out flow. Returns true when it handled the text. */
export async function handleMoveOutText(
  ctx: Context,
  env: Env,
  session: WizardSession,
  text: string,
): Promise<boolean> {
  if (session.flow !== 'moveout' || session.step !== 'mo_enter_date') return false;

  const endDate = parseDate(text);
  if (!endDate) {
    await ctx.reply('❌ Invalid date. Use `YYYY-MM-DD` or `DD/MM/YYYY`', { parse_mode: 'Markdown' });
    return true;
  }

  await showConfirm(ctx, env, session, endDate);
  return true;
}
