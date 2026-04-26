import { describe, it, expect } from 'vitest';
import { buildQS } from '../src/qs';

describe('buildQS', () => {
  it('serializes scalar params with key=value', () => {
    const qs = buildQS({ filterByFormula: '{Foo}=1' });
    expect(qs.toString()).toBe('filterByFormula=%7BFoo%7D%3D1');
  });

  it('serializes array params with bracket notation', () => {
    const qs = buildQS({ fields: ['Label', 'Monthly Rent'] });
    expect(qs.toString()).toBe('fields%5B%5D=Label&fields%5B%5D=Monthly+Rent');
  });

  it('combines scalar and array params', () => {
    const qs = buildQS({
      fields:          ['Label'],
      filterByFormula: 'TRUE()',
    });
    const params = Array.from(qs.entries());
    expect(params).toContainEqual(['fields[]', 'Label']);
    expect(params).toContainEqual(['filterByFormula', 'TRUE()']);
  });

  it('appends offset last when provided', () => {
    const qs = buildQS({ fields: ['Label'] }, 'off-token-123');
    expect(qs.get('offset')).toBe('off-token-123');
  });

  it('omits offset when undefined', () => {
    const qs = buildQS({ fields: ['Label'] });
    expect(qs.has('offset')).toBe(false);
  });
});
