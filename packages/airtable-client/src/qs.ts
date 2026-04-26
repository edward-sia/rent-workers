export function buildQS(
  params: Record<string, string | string[]>,
  offset?: string,
): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) qs.append(`${key}[]`, v);
    } else {
      qs.set(key, value);
    }
  }
  if (offset) qs.set('offset', offset);
  return qs;
}
