export interface ChargeLike {
  id: string;
  fields: { 'Due Date'?: string; Balance?: number; Status?: string };
}

/** An error message for the operator, or null when the end date is fine. */
export function checkEndDate(endDate: string, startDate: string | undefined): string | null {
  if (startDate && endDate < startDate) {
    return `End date can't be before the start date (${startDate}).`;
  }
  return null;
}

/** Charges due after `endDate`, in due-date order. */
export function chargesAfter<T extends ChargeLike>(charges: T[], endDate: string): T[] {
  return charges
    .filter((c) => c.fields['Due Date'] !== undefined && c.fields['Due Date'] > endDate)
    .sort((a, b) => (a.fields['Due Date'] as string).localeCompare(b.fields['Due Date'] as string));
}

/** Sum of unpaid balances on charges due on or before `endDate`. */
export function owedThrough(charges: ChargeLike[], endDate: string): number {
  let total = 0;
  for (const c of charges) {
    const due = c.fields['Due Date'];
    const balance = c.fields.Balance ?? 0;
    if (c.fields.Status === 'Paid' || balance <= 0) continue;
    if (due === undefined || due > endDate) continue;
    total += balance;
  }
  return Math.round(total * 100) / 100;
}
