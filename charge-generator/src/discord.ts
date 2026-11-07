/** What one run did, as record-ID-only lines for the Discord summary. */
export interface RunSummary {
  created: string[];
  /** Tenancies that already had a charge for the period. */
  existed: string[];
  /** Tenancies skipped because the due date is before Start Date or after End Date. */
  outside: string[];
  errors: string[];
}

export async function notifyDiscord(
  webhookUrl: string,
  period: string,
  { created, existed, outside, errors }: RunSummary,
): Promise<boolean> {
  const colour = errors.length > 0 ? 0xff4444
    : created.length > 0 ? 0x00c851
    : 0xffbb33;

  const embed = {
    title: `🏠 Rent Charges — ${period}`,
    color: colour,
    timestamp: new Date().toISOString(),
    fields: [
      {
        name: `✅ Created (${created.length})`,
        value: created.length ? created.join('\n') : '—',
        inline: false,
      },
      {
        name: `⏭ Already existed (${existed.length})`,
        value: existed.length ? existed.join('\n') : '—',
        inline: false,
      },
      ...(outside.length ? [{
        name: `⏭ Skipped: outside tenancy dates (${outside.length})`,
        value: outside.join('\n'),
        inline: false,
      }] : []),
      ...(errors.length ? [{
        name: `❌ Errors (${errors.length})`,
        value: errors.join('\n'),
        inline: false,
      }] : []),
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      console.error(`[Discord] webhook failed: status=${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[Discord] webhook threw: ${(e as Error).message}`);
    return false;
  }
}
