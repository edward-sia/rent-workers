import {
  ChargeSchema,
  formulaString,
  type Room,
  RoomSchema,
  TABLES,
  TenancySchema,
  TenantSchema,
} from '@rent/airtable-client';
import {
  buildBondCharge,
  buildRentCharge,
  checkStartDate,
  dueDayFor,
  partMonthAmount,
  planMoveInCharges,
  suggestedBond,
  tenancyLabel,
  type FirstPaymentOption,
  type PlannedCharge,
} from '@rent/tenancy';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { airtableFor } from './airtable';
import { claimSave, confirmPattern, newOpId } from './confirm';
import {
  escapeTelegramMarkdown as esc,
  formatAUD,
  httpStatusOf,
  logAirtableFailure,
  melbourneDateISO,
  parseAmount,
  parseDate,
} from './format';
import {
  bondPrompt,
  capitalize,
  confirmPrompt,
  existingTenantPrompt,
  failureText,
  firstOfNextMonth,
  firstPaymentPrompt,
  isFirstOfMonth,
  link,
  type MoveIn,
  notesPrompt,
  partAmountPrompt,
  type Prompt,
  rentPrompt,
  startPrompt,
} from './movein-view';
import { clearSession, getSession, setSession } from './session';
import type { Env, SessionChoice, WizardSession, WizardStep } from './types';

const EXPIRED = '⚠️ This move-in was already saved or has expired. Use /movein to start again.';
/** Plain text. A Confirm still saving, or one cut off mid-save, leaves the session at `saving`. */
const SAVING =
  '⏳ This move-in is already being saved, or the save has finished. Check Airtable before you try again.';
/** Markdown. Shown above the confirm screen when the charges changed since it was last shown. */
const PLAN_CHANGED =
  '⚠️ *The charges changed since you saw this screen*, because the monthly charge run has happened. Nothing was saved. Check them and confirm again.';
const MARKDOWN = { parse_mode: 'Markdown' } as const;
const ROOM_FIELDS = ['Code', 'Default Rent', 'Status'];

/** `action` names the Airtable call, like `create Tenancies`. */
function logFailure(action: string, error: unknown): void {
  logAirtableFailure('movein', action, error);
}

/** Save the session, then show the prompt: edit the tapped message for buttons, reply for typed text. */
async function ask(ctx: Context, env: Env, session: WizardSession, prompt: Prompt): Promise<void> {
  await setSession(ctx.from!.id, session, env.SESSION_KV);
  const options = { ...MARKDOWN, reply_markup: prompt.keyboard };
  if (ctx.callbackQuery) {
    await ctx.editMessageText(prompt.text, options);
  } else {
    await ctx.reply(prompt.text, options);
  }
}

/** The move-in session when it is at `step`. Otherwise says "expired" and returns null. */
async function sessionAt(ctx: Context, env: Env, step: WizardStep): Promise<WizardSession | null> {
  const session = await getSession(ctx.from!.id, env.SESSION_KV);
  if (session.flow === 'movein' && session.step === step) return session;
  await ctx.editMessageText(EXPIRED);
  return null;
}

function roomChoice(room: Room): SessionChoice {
  return { label: room.Code, defaultRent: room['Default Rent'], occupied: room.Status === 'Occupied' };
}

function moveInOf(session: WizardSession): MoveIn | null {
  const { roomId, roomCode, tenantName, monthlyRent, startDate, firstOption, firstAmount, bond } = session;
  if (!roomId || !roomCode || !tenantName || !monthlyRent || !startDate || !firstOption || !firstAmount) {
    return null;
  }
  // A session saved before the bond step existed has no bond. It must not save without one.
  if (typeof bond !== 'number' || bond < 0) return null;
  return {
    roomId, roomCode, tenantName, monthlyRent, startDate, firstOption, firstAmount, bond,
    roomOccupied: session.roomOccupied === true,
    tenantId: session.tenantId,
    tenantNotes: session.tenantNotes,
  };
}

function planFor(moveIn: MoveIn): PlannedCharge[] {
  return planMoveInCharges({
    startDate: moveIn.startDate,
    monthlyRent: moveIn.monthlyRent,
    option: moveIn.firstOption,
    firstAmount: moveIn.firstAmount,
    todayUtc: new Date().toISOString().slice(0, 10),
  });
}

const askNotes = (ctx: Context, env: Env, session: WizardSession): Promise<void> =>
  ask(ctx, env, { ...session, step: 'mi_enter_notes' }, notesPrompt(String(session.tenantName)));

const askRent = (ctx: Context, env: Env, session: WizardSession): Promise<void> =>
  ask(ctx, env, { ...session, step: 'mi_enter_rent' }, rentPrompt(String(session.roomCode), session.defaultRent));

const askStart = (ctx: Context, env: Env, session: WizardSession, monthlyRent: number): Promise<void> =>
  ask(ctx, env, { ...session, step: 'mi_select_start', monthlyRent }, startPrompt(monthlyRent, melbourneDateISO()));

const askFirst = (ctx: Context, env: Env, session: WizardSession, startDate: string): Promise<void> =>
  ask(
    ctx, env, { ...session, step: 'mi_select_first', startDate },
    firstPaymentPrompt(startDate, Number(session.monthlyRent)),
  );

/** After the first payment is settled, ask about the bond. */
const askBond = (
  ctx: Context, env: Env, session: WizardSession, firstOption: FirstPaymentOption, firstAmount: number,
): Promise<void> =>
  ask(
    ctx, env, { ...session, step: 'mi_enter_bond', firstOption, firstAmount },
    bondPrompt(String(session.startDate), Number(session.monthlyRent)),
  );

/** Same charges, in the same order. */
function samePlan(a: PlannedCharge[], b: PlannedCharge[] | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Show the confirm screen with a new operation ID. The session keeps the charges shown,
 * so Confirm can tell when they would no longer match what gets saved.
 */
async function showConfirm(ctx: Context, env: Env, session: WizardSession, notice?: string): Promise<void> {
  const opId = newOpId();
  const updated: WizardSession = { ...session, step: 'mi_confirm', opId };
  const moveIn = moveInOf(updated);
  if (!moveIn) {
    await clearSession(ctx.from!.id, env.SESSION_KV);
    await (ctx.callbackQuery ? ctx.editMessageText(EXPIRED) : ctx.reply(EXPIRED));
    return;
  }
  const plan = planFor(moveIn);
  await ask(ctx, env, { ...updated, plannedCharges: plan }, confirmPrompt(env, moveIn, plan, opId, notice));
}

async function handleName(ctx: Context, env: Env, session: WizardSession, name: string): Promise<void> {
  let matches;
  try {
    matches = await airtableFor(env).fetchAll(TABLES.TENANTS, TenantSchema, {
      fields: ['Name'],
      filterByFormula: `{Name} = ${formulaString(name)}`,
    });
  } catch (e) {
    logFailure('read Tenants', e);
    await clearSession(ctx.from!.id, env.SESSION_KV);
    await ctx.reply('Failed to look up tenants. Check Worker logs, then use /movein to try again.');
    return;
  }

  const match = matches[0];
  if (!match) {
    await askNotes(ctx, env, { ...session, tenantName: name, tenantId: undefined });
    return;
  }
  await ask(
    ctx, env, { ...session, step: 'mi_choose_tenant', tenantName: name, tenantId: match.id },
    existingTenantPrompt(env, name, match.id),
  );
}

/** Do the Confirm writes in order and report which ones finished. There is no rollback. */
async function saveMoveIn(ctx: Context, env: Env, moveIn: MoveIn, plan: PlannedCharge[]): Promise<void> {
  const airtable = airtableFor(env);
  const label = tenancyLabel(moveIn.roomCode, moveIn.tenantName);
  const name = esc(moveIn.tenantName);
  const code = esc(moveIn.roomCode);
  let tenantId = moveIn.tenantId ?? '';
  let tenancyId = '';

  const done: string[] = [];
  if (tenantId) done.push(`👤 Existing tenant ${name}: ${link(env, TABLES.TENANTS, tenantId, 'Open')}`);

  // `action` is the Airtable call, for the log line.
  const steps: { todo: string; check: string; action: string; run: () => Promise<string> }[] = [];
  if (!tenantId) {
    steps.push({
      todo: `create the tenant ${name}`,
      check: link(env, TABLES.TENANTS, null, 'Tenants table'),
      action: 'create Tenants',
      run: async () => {
        const notes = moveIn.tenantNotes ? { Notes: moveIn.tenantNotes } : {};
        tenantId = (await airtable.create(TABLES.TENANTS, TenantSchema, { Name: moveIn.tenantName, ...notes })).id;
        return `👤 Tenant ${name}: ${link(env, TABLES.TENANTS, tenantId, 'Open')}`;
      },
    });
  }
  steps.push({
    todo: `create the tenancy ${esc(label)}`,
    check: link(env, TABLES.TENANCIES, null, 'Tenancies table'),
    action: 'create Tenancies',
    run: async () => {
      const tenancy = await airtable.create(TABLES.TENANCIES, TenancySchema, {
        Label: label,
        Room: [moveIn.roomId],
        Tenant: [tenantId],
        'Start Date': moveIn.startDate,
        'Due Day': dueDayFor(moveIn.firstOption, moveIn.startDate),
        'Monthly Rent': moveIn.monthlyRent,
        Frequency: 'Monthly',
      });
      tenancyId = tenancy.id;
      return `📄 Tenancy ${esc(label)}: ${link(env, TABLES.TENANCIES, tenancyId, 'Open')}`;
    },
  });
  for (const charge of plan) {
    const summary = `${esc(charge.period)} rent charge, ${esc(formatAUD(charge.amount))} due ${esc(charge.dueDate)}`;
    steps.push({
      todo: `create the ${summary}`,
      check: link(env, TABLES.CHARGES, null, 'Charges table'),
      action: 'create Charges',
      run: async () => {
        const fields = buildRentCharge({ tenancyId, tenancyLabel: label, ...charge });
        const created = await airtable.create(TABLES.CHARGES, ChargeSchema, fields);
        return `🧾 ${capitalize(summary)}: ${link(env, TABLES.CHARGES, created.id, 'Open')}`;
      },
    });
  }
  steps.push({
    todo: `set room ${code} to Occupied`,
    check: link(env, TABLES.ROOMS, moveIn.roomId, 'room in Airtable'),
    action: 'update Rooms',
    run: async () => {
      await airtable.update(TABLES.ROOMS, RoomSchema, moveIn.roomId, { Status: 'Occupied' });
      return `🚪 Room ${code} marked Occupied: ${link(env, TABLES.ROOMS, moveIn.roomId, 'Open')}`;
    },
  });
  // Last, so a failed bond write still leaves the tenancy, its rent and the room done.
  if (moveIn.bond > 0) {
    const summary = `bond charge, ${esc(formatAUD(moveIn.bond))} due ${esc(moveIn.startDate)}`;
    steps.push({
      todo: `create the ${summary}`,
      check: link(env, TABLES.CHARGES, null, 'Charges table'),
      action: 'create Charges',
      run: async () => {
        const fields = buildBondCharge({
          tenancyId, tenancyLabel: label, dueDate: moveIn.startDate, amount: moveIn.bond,
        });
        const created = await airtable.create(TABLES.CHARGES, ChargeSchema, fields);
        return `🔒 ${capitalize(summary)}: ${link(env, TABLES.CHARGES, created.id, 'Open')}`;
      },
    });
  }

  for (const [index, step] of steps.entries()) {
    try {
      done.push(await step.run());
    } catch (e) {
      logFailure(step.action, e);
      await clearSession(ctx.from!.id, env.SESSION_KV);
      const text = failureText({
        status: httpStatusOf(e),
        done,
        wroteSomething: index > 0,
        failed: step,
        rest: steps.slice(index + 1).map((later) => later.todo),
      });
      await ctx.editMessageText(text, MARKDOWN);
      return;
    }
  }

  await clearSession(ctx.from!.id, env.SESSION_KV);
  await ctx.editMessageText(['✅ *Move-in saved*', '', ...done].join('\n'), MARKDOWN);
}

export function registerMoveIn(bot: Bot, env: Env): void {
  bot.command('movein', async (ctx) => {
    const userId = ctx.from!.id;
    await clearSession(userId, env.SESSION_KV);

    let rooms;
    try {
      rooms = await airtableFor(env).fetchAll(TABLES.ROOMS, RoomSchema, { fields: ROOM_FIELDS });
    } catch (e) {
      logFailure('read Rooms', e);
      await ctx.reply('Failed to load rooms. Check Worker logs.');
      return;
    }
    if (rooms.length === 0) {
      await ctx.reply('No rooms found.');
      return;
    }

    const vacant = (room: Room): number => (room.Status === 'Vacant' ? 0 : 1);
    rooms.sort((a, b) => vacant(a.fields) - vacant(b.fields) || a.fields.Code.localeCompare(b.fields.Code));
    const keyboard = new InlineKeyboard();
    const choices: Record<string, SessionChoice> = {};
    for (const room of rooms) {
      keyboard.text(`${room.fields.Code} · ${room.fields.Status ?? 'no status'}`, `mi:r:${room.id}`).row();
      choices[room.id] = roomChoice(room.fields);
    }

    await setSession(userId, { flow: 'movein', step: 'mi_select_room', choices }, env.SESSION_KV);
    await ctx.reply('🏠 *Which room is the tenant moving into?*', { ...MARKDOWN, reply_markup: keyboard });
  });

  // Always starts a fresh move-in. The move-out handover button arrives with no room list in the session.
  bot.callbackQuery(/^mi:r:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const roomId = ctx.match[1] ?? '';
    const session = await getSession(userId, env.SESSION_KV);
    const listed = session.flow === 'movein' ? session.choices?.[roomId] : undefined;

    let room = listed;
    if (!room) {
      try {
        const records = await airtableFor(env).fetchAll(TABLES.ROOMS, RoomSchema, {
          fields: ROOM_FIELDS,
          filterByFormula: `RECORD_ID() = ${formulaString(roomId)}`,
        });
        room = records[0] ? roomChoice(records[0].fields) : undefined;
      } catch (e) {
        logFailure('read Rooms', e);
        await clearSession(userId, env.SESSION_KV);
        await ctx.reply('Failed to load the room. Check Worker logs, then use /movein to try again.');
        return;
      }
    }
    if (!room) {
      await clearSession(userId, env.SESSION_KV);
      await ctx.reply('Room not found. Use /movein to pick a room.');
      return;
    }

    await setSession(userId, {
      flow: 'movein',
      step: 'mi_enter_name',
      roomId,
      roomCode: room.label,
      roomOccupied: room.occupied,
      defaultRent: room.defaultRent,
    }, env.SESSION_KV);
    // A pick from the room list edits that list. The handover button gets a new message,
    // so the move-out summary it sits under stays readable.
    const text = `🚪 Room ${esc(room.label)}\n\n👤 Type the tenant's name:`;
    if (listed) await ctx.editMessageText(text, MARKDOWN);
    else await ctx.reply(text, MARKDOWN);
  });

  bot.callbackQuery(/^mi:tenant:(existing|new)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = await sessionAt(ctx, env, 'mi_choose_tenant');
    if (!session) return;
    if (ctx.match[1] === 'new') await askNotes(ctx, env, { ...session, tenantId: undefined });
    else await askRent(ctx, env, session);
  });

  bot.callbackQuery('mi:notes:skip', async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = await sessionAt(ctx, env, 'mi_enter_notes');
    if (session) await askRent(ctx, env, session);
  });

  bot.callbackQuery('mi:rent:default', async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = await sessionAt(ctx, env, 'mi_enter_rent');
    if (!session) return;
    if (!session.defaultRent) {
      await ctx.editMessageText(EXPIRED);
      return;
    }
    await askStart(ctx, env, session, session.defaultRent);
  });

  bot.callbackQuery(/^mi:s:(today|next1|manual)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = await sessionAt(ctx, env, 'mi_select_start');
    if (!session) return;

    const today = melbourneDateISO();
    if (ctx.match[1] === 'manual') {
      await setSession(ctx.from.id, { ...session, step: 'mi_enter_start' }, env.SESSION_KV);
      await ctx.editMessageText('Enter the start date in `YYYY-MM-DD` or `DD/MM/YYYY` format:', MARKDOWN);
      return;
    }
    // Neither button can give a date more than 60 days back, so there is nothing to check.
    await askFirst(ctx, env, session, ctx.match[1] === 'next1' ? firstOfNextMonth(today) : today);
  });

  bot.callbackQuery(/^mi:f:(regular|part)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = await sessionAt(ctx, env, 'mi_select_first');
    if (!session) return;

    const startDate = String(session.startDate);
    const monthlyRent = Number(session.monthlyRent);
    if (ctx.match[1] === 'regular') {
      await askBond(ctx, env, session, 'regular', monthlyRent);
      return;
    }
    // A part-month button from an older message, after a start on the 1st was picked.
    if (isFirstOfMonth(startDate)) {
      await ctx.editMessageText(EXPIRED);
      return;
    }
    await ask(
      ctx, env, { ...session, step: 'mi_enter_first_amount', firstOption: 'part_month' },
      partAmountPrompt(startDate, monthlyRent),
    );
  });

  bot.callbackQuery('mi:amt:suggested', async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = await sessionAt(ctx, env, 'mi_enter_first_amount');
    if (!session) return;
    const amount = partMonthAmount(Number(session.monthlyRent), String(session.startDate));
    await askBond(ctx, env, session, 'part_month', amount);
  });

  bot.callbackQuery(/^mi:bond:(suggested|none)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = await sessionAt(ctx, env, 'mi_enter_bond');
    if (!session) return;
    const bond = ctx.match[1] === 'none' ? 0 : suggestedBond(Number(session.monthlyRent));
    await showConfirm(ctx, env, { ...session, bond });
  });

  bot.callbackQuery(confirmPattern('mi:confirm'), async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const opId = ctx.match[1];
    const session = await getSession(userId, env.SESSION_KV);
    // The button must belong to the screen the session is on. An older screen's button,
    // say from a move-in that was cancelled, must not save the current one.
    const ours = opId !== undefined && session.flow === 'movein' && session.opId === opId;
    if (ours && session.step === 'saving') {
      await ctx.editMessageText(SAVING);
      return;
    }
    const moveIn = ours && session.step === 'mi_confirm' ? moveInOf(session) : null;
    if (!opId || !moveIn) {
      await ctx.editMessageText(EXPIRED);
      return;
    }

    // The charges depend on today's UTC date. Show the screen again if they changed.
    const plan = planFor(moveIn);
    if (!samePlan(plan, session.plannedCharges)) {
      await showConfirm(ctx, env, session, PLAN_CHANGED);
      return;
    }

    // Only one tap per operation gets past this, even when two arrive at once.
    if (!(await claimSave(ctx, env, opId, 'movein', SAVING))) return;
    // `saving` makes Cancel and typed text say "already saving" while the writes run.
    await setSession(userId, { ...session, step: 'saving' }, env.SESSION_KV);
    await saveMoveIn(ctx, env, moveIn, plan);
  });

  bot.callbackQuery('mi:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = await getSession(ctx.from.id, env.SESSION_KV);
    if (session.step === 'saving') {
      await ctx.editMessageText(session.flow === 'movein' ? SAVING : EXPIRED);
      return;
    }
    if (session.flow === 'movein') await clearSession(ctx.from.id, env.SESSION_KV);
    await ctx.editMessageText('❌ Move-in cancelled. Nothing was changed.');
  });
}

/** Handles typed text for the move-in flow. Returns true when it handled the text. */
export async function handleMoveInText(
  ctx: Context,
  env: Env,
  session: WizardSession,
  text: string,
): Promise<boolean> {
  if (session.flow !== 'movein') return false;

  switch (session.step) {
    case 'mi_enter_name':
      await handleName(ctx, env, session, text);
      return true;
    case 'mi_enter_notes':
      await askRent(ctx, env, { ...session, tenantNotes: text });
      return true;
    case 'mi_enter_rent':
    case 'mi_enter_first_amount':
    case 'mi_enter_bond': {
      const amount = parseAmount(text);
      if (amount === null) {
        await ctx.reply('❌ Invalid amount. Enter a number like `1650` or `1650.00`', MARKDOWN);
      } else if (session.step === 'mi_enter_rent') {
        await askStart(ctx, env, session, amount);
      } else if (session.step === 'mi_enter_first_amount') {
        await askBond(ctx, env, session, 'part_month', amount);
      } else {
        await showConfirm(ctx, env, { ...session, bond: amount });
      }
      return true;
    }
    case 'mi_enter_start': {
      const startDate = parseDate(text);
      if (!startDate) {
        await ctx.reply('❌ Invalid date. Use `YYYY-MM-DD` or `DD/MM/YYYY`', MARKDOWN);
        return true;
      }
      // Plain text: checkStartDate messages carry no Markdown.
      const problem = checkStartDate(startDate, melbourneDateISO());
      if (problem) {
        await ctx.reply(`❌ ${problem}\n\nEnter the start date again:`);
        return true;
      }
      await askFirst(ctx, env, session, startDate);
      return true;
    }
    default:
      return false;
  }
}
