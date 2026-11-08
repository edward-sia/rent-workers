/** Returns a double-quoted Airtable formula string literal, escaping `\` then `"`. */
export function formulaString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
