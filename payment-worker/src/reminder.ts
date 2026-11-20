import { escapeTelegramMarkdown, formatAUD } from './format';
import {
  groupReminderChargesByTenant,
  type ReminderBuckets,
  type ReminderCharge,
  type ReminderTenantGroup,
} from './outstanding';

const TELEGRAM_SAFE_MESSAGE_LENGTH = 3900;

export interface FormatReminderOptions {
  maxMessageLength?: number;
  channel?: 'telegram' | 'whatsapp';
}

export function formatReminderMessages(
  buckets: ReminderBuckets,
  options: FormatReminderOptions = {},
): string[] {
  const maxMessageLength = options.maxMessageLength ?? (options.channel === 'whatsapp' ? 4096 : TELEGRAM_SAFE_MESSAGE_LENGTH);
  const blocks: string[] = [];

  addSection(blocks, 'Pay now', buckets.payNowTotal, groupReminderChargesByTenant(buckets.payNow));
  addSection(blocks, 'Due in next 14 days', buckets.dueSoonTotal, groupReminderChargesByTenant(buckets.dueSoon));

  if (blocks.length === 0) {
    return ['No overdue payments or payments due in the next 14 days.'];
  }

  const rendered = options.channel === 'whatsapp' ? blocks : blocks.map(escapeTelegramMarkdown);
  return splitBlocks(rendered, maxMessageLength);
}

function addSection(
  blocks: string[],
  title: string,
  total: number,
  groups: ReminderTenantGroup[],
): void {
  if (groups.length === 0) return;

  blocks.push(`${title} - subtotal ${formatAUD(total)}`);
  for (const group of groups) {
    blocks.push(formatTenantGroup(group));
  }
}

function formatTenantGroup(group: ReminderTenantGroup): string {
  const lines = [
    `${group.tenantLabel} - subtotal ${formatAUD(group.subtotal)}`,
    ...group.charges.map(formatChargeRow),
  ];
  return lines.join('\n');
}

function formatChargeRow(charge: ReminderCharge): string {
  return `• ${charge.rowLabel} · ${formatAUD(charge.balance)}`;
}

function splitBlocks(blocks: string[], maxLength: number): string[] {
  const messages: string[] = [];
  let current = '';

  for (const block of blocks) {
    if (block.length > maxLength) {
      if (current) {
        messages.push(current);
        current = '';
      }
      messages.push(...splitLargeBlock(block, maxLength));
      continue;
    }

    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > maxLength && current) {
      messages.push(current);
      current = block;
    } else {
      current = next;
    }
  }

  if (current) messages.push(current);
  return messages;
}

function splitLargeBlock(block: string, maxLength: number): string[] {
  const lines = block.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (line.length > maxLength) {
      if (current) chunks.push(current);
      current = '';
      for (const character of line) {
        if (current.length + character.length > maxLength && current) {
          chunks.push(current);
          current = '';
        }
        current += character;
      }
      continue;
    }
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
