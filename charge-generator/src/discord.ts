export async function notifyDiscord(
  webhookUrl: string,
  period: string,
  created: string[],
  skipped: string[],
  errors: string[],
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
        name: `⏭ Already existed (${skipped.length})`,
        value: skipped.length ? skipped.join('\n') : '—',
        inline: false,
      },
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
      console.error(`[Discord] webhook failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[Discord] webhook threw: ${(e as Error).message}`);
    return false;
  }
}
