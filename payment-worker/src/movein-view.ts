import { TABLES } from '@rent/airtable-client';
import {
  addMonths,
  dueDayFor,
  endOfMonthISO,
  partMonthAmount,
  periodOf,
  tenancyLabel,
  type FirstPaymentOption,
  type PlannedCharge,
} from '@rent/tenancy';
import { InlineKeyboard } from 'grammy';
import { confirmData } from './confirm';
import { escapeTelegramMarkdown as esc, escapeTelegramMarkdownUrl, formatAUD } from './format';
import type { Env } from './types';

/** Everything Confirm needs, checked present. */
export interface MoveIn {
  roomId: string;
  roomCode: string;
  roomOccupied: boolean;
  tenantId?: string;
  tenantName: string;
  tenantNotes?: string;
  monthlyRent: number;
  startDate: string;
  firstOption: FirstPaymentOption;
  firstAmount: number;
}

/** A Markdown link with fixed link text. Telegram does not allow escapes inside link text. */
export function link(env: Env, tableId: string, recordId: string | null, label: string): string {
  const path = recordId ? `${tableId}/${recordId}` : tableId;
  const url = `https://airtable.com/${env.AIRTABLE_BASE_ID}/${path}`;
  return `[${label}](${escapeTelegramMarkdownUrl(url)})`;
}

export const isFirstOfMonth = (isoDate: string): boolean => isoDate.endsWith('-01');

export const firstOfNextMonth = (today: string): string => `${addMonths(periodOf(today), 1)}-01`;

export interface Prompt {
  text: string;
  keyboard?: InlineKeyboard;
}

export function existingTenantPrompt(env: Env, name: string, tenantId: string): Prompt {
  return {
    text:
      `👤 A tenant named ${esc(name)} is already in Airtable: ${link(env, TABLES.TENANTS, tenantId, 'Open')}\n\n` +
      'Use that record, or create a new tenant?',
    keyboard: new InlineKeyboard().text('Use existing', 'mi:tenant:existing').text('Create new', 'mi:tenant:new'),
  };
}

export function notesPrompt(name: string): Prompt {
  return {
    text: `👤 New tenant: ${esc(name)}\n\n📝 Type notes for this tenant, or tap Skip.`,
    keyboard: new InlineKeyboard().text('Skip', 'mi:notes:skip'),
  };
}

export function rentPrompt(roomCode: string, defaultRent: number | undefined): Prompt {
  const code = esc(roomCode);
  if (!defaultRent) return { text: `💰 Type the monthly rent for ${code}:` };
  return {
    text: `💰 Monthly rent for ${code}? Tap the default or type an amount:`,
    keyboard: new InlineKeyboard().text(`Use ${formatAUD(defaultRent)}`, 'mi:rent:default'),
  };
}

export function startPrompt(monthlyRent: number, today: string): Prompt {
  return {
    text: `💰 Monthly rent: ${esc(formatAUD(monthlyRent))}\n\n📅 When does the tenancy start?`,
    keyboard: new InlineKeyboard()
      .text(`Today (${today})`, 'mi:s:today').row()
      .text(`1st of next month (${firstOfNextMonth(today)})`, 'mi:s:next1').row()
      .text('✏️ Enter date', 'mi:s:manual').row(),
  };
}

/** The first-payment question. The part-month choice is left out for a start on the 1st. */
export function firstPaymentPrompt(startDate: string, monthlyRent: number): Prompt {
  const rent = esc(formatAUD(monthlyRent));
  let text =
    `📅 Start date: ${esc(startDate)}\n\nHow does the first payment work?\n\n` +
    `• *Regular monthly:* ${rent} due ${esc(startDate)}, then monthly on day ${dueDayFor('regular', startDate)}.`;
  const keyboard = new InlineKeyboard().text('Regular monthly from start date', 'mi:f:regular').row();

  if (!isFirstOfMonth(startDate)) {
    const part = esc(formatAUD(partMonthAmount(monthlyRent, startDate)));
    text += `\n• *Part month:* about ${part} for the rest of ${esc(periodOf(startDate))}, then ${rent} on the 1st.`;
    keyboard.text('Part month, then monthly on the 1st', 'mi:f:part').row();
  }
  return { text, keyboard };
}

export function partAmountPrompt(startDate: string, monthlyRent: number): Prompt {
  const suggested = formatAUD(partMonthAmount(monthlyRent, startDate));
  return {
    text:
      `🧾 Part month: ${esc(startDate)} to ${esc(endOfMonthISO(startDate))}.\n` +
      `Suggested: ${esc(suggested)} (rent × 12 ÷ 365 per day).\n\n` +
      `Tap the suggestion or type a different amount:`,
    keyboard: new InlineKeyboard().text(`Use ${suggested}`, 'mi:amt:suggested'),
  };
}

/** `notice` is Markdown shown above the summary, like why the screen was shown again. */
export function confirmPrompt(
  env: Env,
  moveIn: MoveIn,
  plan: PlannedCharge[],
  opId: string,
  notice?: string,
): Prompt {
  const text = confirmText(env, moveIn, plan);
  return {
    text: notice ? `${notice}\n\n${text}` : text,
    keyboard: new InlineKeyboard()
      .text('✅ Confirm', confirmData('mi:confirm', opId))
      .text('❌ Cancel', 'mi:cancel'),
  };
}

function confirmText(env: Env, moveIn: MoveIn, plan: PlannedCharge[]): string {
  const code = esc(moveIn.roomCode);
  const name = esc(moveIn.tenantName);
  const lines = ['📋 *Confirm Move-In*', ''];
  if (moveIn.roomOccupied) {
    lines.push(`⚠️ ${code} is currently Occupied. Check that the last tenancy has ended.`, '');
  }

  lines.push(`🚪 *Room:* ${code}`);
  lines.push(moveIn.tenantId
    ? `👤 *Tenant:* ${name}, existing tenant ${link(env, TABLES.TENANTS, moveIn.tenantId, 'Open')}`
    : `👤 *Tenant:* ${name}, new tenant`);
  if (moveIn.tenantNotes) lines.push(`📝 *Notes:* ${esc(moveIn.tenantNotes)}`);
  lines.push(
    `🏷 *Tenancy label:* ${esc(tenancyLabel(moveIn.roomCode, moveIn.tenantName))}`,
    `💰 *Monthly rent:* ${esc(formatAUD(moveIn.monthlyRent))}`,
    `📅 *Start date:* ${esc(moveIn.startDate)}`,
    `🗓 *Due day:* ${dueDayFor(moveIn.firstOption, moveIn.startDate)}`,
    '',
    '🧾 *Charges to create:*',
  );
  for (const charge of plan) {
    lines.push(`• ${esc(charge.period)} · ${esc(charge.dueDate)} · ${esc(formatAUD(charge.amount))}`);
  }
  lines.push('', `🚪 Room ${code} will be marked *Occupied*.`);
  return lines.join('\n');
}

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The reply when a Confirm write fails. A 4xx means the failed write did not apply.
 * Anything else (5xx, timeout, unreadable response) may have applied after all.
 */
export function failureText(input: {
  status: string;
  done: string[];
  wroteSomething: boolean;
  failed: { todo: string; check: string };
  rest: string[];
}): string {
  const { status, done, wroteSomething, failed, rest } = input;
  const notApplied = /^HTTP 4\d\d$/.test(status);
  if (notApplied && !wroteSomething) {
    return `❌ Move-in not saved: could not ${failed.todo} (${esc(status)}). Nothing was changed. Check Worker logs.`;
  }

  const lines = ['⚠️ *Move-in not finished*', ''];
  if (done.length > 0) lines.push('Done:', ...done, '');
  if (notApplied) {
    lines.push(`❌ Could not ${failed.todo} (${esc(status)}). It was not saved.`);
  } else {
    lines.push(
      `⚠️ This step may have saved: ${failed.todo} (${esc(status)}). ` +
      `Check the ${failed.check} before you redo it.`,
    );
  }
  const todo = [notApplied ? failed.todo : `${failed.todo}, if it did not save`, ...rest];
  lines.push('', 'Still to do in Airtable:', ...todo.map((item) => `• ${capitalize(item)}`));
  return lines.join('\n');
}
