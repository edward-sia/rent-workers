import { describe, it, expect } from 'vitest';
import { formulaString } from '../src/formula';

describe('formulaString', () => {
  it('wraps a plain value in double quotes', () => {
    expect(formulaString('Sun Peng')).toBe('"Sun Peng"');
  });

  it('escapes backslashes first, then double quotes', () => {
    expect(formulaString('O"Brien \\ Jr')).toBe('"O\\"Brien \\\\ Jr"');
  });

  it('keeps non-ASCII characters', () => {
    expect(formulaString('小刚夫妇')).toBe('"小刚夫妇"');
  });
});
