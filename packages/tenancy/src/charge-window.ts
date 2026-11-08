export interface TenancyDates {
  'Start Date'?: string;
  'End Date'?: string;
}

/**
 * True when `dueDate` (YYYY-MM-DD) falls inside the tenancy's Start Date…End Date.
 * A missing bound means no limit on that side. Both bounds are inclusive.
 */
export function isWithinTenancy(dueDate: string, tenancy: TenancyDates): boolean {
  const start = tenancy['Start Date'];
  const end = tenancy['End Date'];
  if (start && dueDate < start) return false;
  if (end && dueDate > end) return false;
  return true;
}
