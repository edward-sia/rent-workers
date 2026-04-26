export const formatAUD = (n: number): string =>
  `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

export const escapeTelegramMarkdown = (value: string): string =>
  value.replace(/([\\_*[\]()`])/g, '\\$1');

export const escapeTelegramMarkdownUrl = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\)/g, '\\)');

export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;

  const amount = Number.parseFloat(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return amount;
}

export function parseDate(input: string): string | null {
  let candidate: string | null = null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    candidate = input;
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) {
    const [day, month, year] = input.split('/');
    candidate = `${year}-${month}-${day}`;
  }

  if (!candidate) return null;

  const timestamp = Date.parse(`${candidate}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return null;

  return new Date(timestamp).toISOString().slice(0, 10) === candidate ? candidate : null;
}

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

export const yesterdayISO = (): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};
