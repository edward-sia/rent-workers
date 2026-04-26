export function resolveDueDate(
  fields: { 'Due Day'?: number; 'Start Date'?: string },
  year: number,
  month: string,
): string {
  const overrideDay = fields['Due Day'];
  if (overrideDay && overrideDay >= 1 && overrideDay <= 28) {
    return `${year}-${month}-${String(overrideDay).padStart(2, '0')}`;
  }

  const startDate = fields['Start Date'];
  if (startDate) {
    const day = new Date(startDate).getUTCDate();
    const safeDay = Math.min(day, 28);
    return `${year}-${month}-${String(safeDay).padStart(2, '0')}`;
  }

  return `${year}-${month}-01`;
}
