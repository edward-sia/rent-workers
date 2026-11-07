const MS_PER_DAY = 86_400_000;

function toUTC(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function splitPeriod(period: string): [number, number] {
  const [year, month] = period.split('-').map(Number);
  if (year === undefined || month === undefined || Number.isNaN(year) || Number.isNaN(month)) {
    throw new Error(`Invalid period: ${period}`);
  }
  return [year, month];
}

/** '2026-11-20' → '2026-11' */
export function periodOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** ('2026-12', 1) → '2027-01' */
export function addMonths(period: string, n: number): string {
  const [year, month] = splitPeriod(period);
  const shifted = new Date(Date.UTC(year, month - 1 + n, 1));
  return toISO(shifted).slice(0, 7);
}

export function daysInMonth(period: string): number {
  const [year, month] = splitPeriod(period);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDaysISO(isoDate: string, days: number): string {
  return toISO(new Date(toUTC(isoDate).getTime() + days * MS_PER_DAY));
}

export function endOfMonthISO(isoDate: string): string {
  const period = periodOf(isoDate);
  return `${period}-${String(daysInMonth(period)).padStart(2, '0')}`;
}
