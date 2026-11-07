import type { FirstPaymentOption } from '@rent/tenancy';

// ── Cloudflare Worker env bindings ───────────────────────
export interface Env {
  TELEGRAM_BOT_TOKEN: string;   // from @BotFather
  TELEGRAM_WEBHOOK_SECRET: string;
  AIRTABLE_TOKEN: string;      // PAT: data.records:read + write
  AIRTABLE_BASE_ID: string;    // app6He8xRaUzNBTDl
  AUTHORIZED_USER_ID: string;  // your Telegram numeric user ID
  SESSION_KV: KVNamespace;
}

// ── Wizard session — persisted in KV between Telegram messages ──
export type WizardStep =
  | 'idle'
  | 'select_charge'
  | 'enter_amount'
  | 'select_method'
  | 'select_date'
  | 'enter_date'
  | 'confirm'
  | 'mo_select_date'
  | 'mo_enter_date'
  | 'mo_confirm'
  | 'mi_select_room'
  | 'mi_enter_name'
  | 'mi_choose_tenant'
  | 'mi_enter_notes'
  | 'mi_enter_rent'
  | 'mi_select_start'
  | 'mi_enter_start'
  | 'mi_select_first'
  | 'mi_enter_first_amount'
  | 'mi_confirm'
  | 'saving';

export type Flow = 'pay' | 'movein' | 'moveout';

export interface SessionChoice {
  label: string;
  startDate?: string;
  roomId?: string;
  defaultRent?: number;
  occupied?: boolean;
}

export interface WizardSession {
  step: WizardStep;
  flow?: Flow;
  tenancyId?: string;
  tenancyLabel?: string;
  chargeId?: string;
  chargeLabel?: string;
  chargeBalance?: number;   // outstanding on selected charge
  amount?: number;
  method?: string;          // "Cash" | "Bank Transfer"
  date?: string;            // YYYY-MM-DD

  // move-out
  endDate?: string;
  startDate?: string;
  roomId?: string;
  roomCode?: string;

  // move-in
  roomOccupied?: boolean;
  defaultRent?: number;
  tenantId?: string;
  tenantName?: string;
  tenantNotes?: string;
  monthlyRent?: number;
  firstOption?: FirstPaymentOption;
  firstAmount?: number;

  // list picks, keyed by the short id used in callback data
  choices?: Record<string, SessionChoice>;
}
