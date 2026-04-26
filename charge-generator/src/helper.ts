/** Build URLSearchParams that handles Airtable's fields[] bracket notation */
export function buildQS(
  params: Record<string, string | string[]>,
  offset?: string,
): URLSearchParams {
  const qs = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      // Airtable requires:  fields[]=Label&fields[]=Monthly+Rent&...
      value.forEach(v => qs.append(`${key}[]`, v));
    } else {
      qs.set(key, value);
    }
  }

  if (offset) qs.set('offset', offset);
  return qs;
}
