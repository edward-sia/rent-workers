import { addDaysISO, addMonths, daysInMonth, periodOf } from './dates';
import { resolveDueDate } from './due-date';

export type FirstPaymentOption = 'regular' | 'part_month';

export interface PlannedCharge {
  period: string;
  dueDate: string;
  amount: number;
}

/** How many days back a start date may be before we treat it as a typo. */
const MAX_DAYS_IN_PAST = 60;

/** The generator runs on this day of the month (UTC) and creates next month's charges. */
const GENERATOR_RUN_DAY = 15;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** '6B-R6', 'Sun Peng' → '6B-R6 Sun Peng' */
export function tenancyLabel(roomCode: string, tenantName: string): string {
  return `${roomCode.trim()} ${tenantName.trim()}`;
}

/** Regular: the start day, capped at 28. Part month: the 1st. */
export function dueDayFor(option: FirstPaymentOption, startDate: string): number {
  if (option === 'part_month') return 1;
  return Math.min(Number(startDate.slice(8, 10)), 28);
}

/** Prorated rent from the start date to month end: rent × 12 ÷ 365 per day. */
export function partMonthAmount(monthlyRent: number, startDate: string): number {
  const daysLeft = daysInMonth(periodOf(startDate)) - Number(startDate.slice(8, 10)) + 1;
  return round2(((monthlyRent * 12) / 365) * daysLeft);
}

/** An error message for the operator, or null when the start date is fine. */
export function checkStartDate(startDate: string, today: string): string | null {
  const earliest = addDaysISO(today, -MAX_DAYS_IN_PAST);
  if (startDate < earliest) {
    return `Start date can't be more than ${MAX_DAYS_IN_PAST} days in the past.`;
  }
  return null;
}

/** The last period (YYYY-MM) that the generator has already created charges for. */
export function generatedThrough(todayUtc: string): string {
  const period = periodOf(todayUtc);
  return Number(todayUtc.slice(8, 10)) >= GENERATOR_RUN_DAY ? addMonths(period, 1) : period;
}

/**
 * The charges to create at move-in: the first charge for the start month,
 * then one regular charge per month up to what the generator has already covered.
 */
export function planMoveInCharges(input: {
  startDate: string;
  monthlyRent: number;
  option: FirstPaymentOption;
  firstAmount: number;
  todayUtc: string;
}): PlannedCharge[] {
  const { startDate, monthlyRent, option, firstAmount, todayUtc } = input;
  const startPeriod = periodOf(startDate);
  const charges: PlannedCharge[] = [{ period: startPeriod, dueDate: startDate, amount: firstAmount }];

  const last = generatedThrough(todayUtc);
  const dueDay = dueDayFor(option, startDate);
  for (let period = addMonths(startPeriod, 1); period <= last; period = addMonths(period, 1)) {
    const [year, month] = period.split('-');
    charges.push({
      period,
      dueDate: resolveDueDate({ 'Due Day': dueDay }, Number(year), month as string),
      amount: monthlyRent,
    });
  }
  return charges;
}
