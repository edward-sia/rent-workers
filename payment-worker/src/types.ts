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
  | 'confirm';

export interface WizardSession {
  step: WizardStep;
  tenancyId?: string;
  tenancyLabel?: string;
  chargeId?: string;
  chargeLabel?: string;
  chargeBalance?: number;   // outstanding on selected charge
  amount?: number;
  method?: string;          // "Cash" | "Bank Transfer"
  date?: string;            // YYYY-MM-DD
}
