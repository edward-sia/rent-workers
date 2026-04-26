import { describe, it, expect } from 'vitest';
import { TenancySchema, ChargeSchema, PaymentSchema } from '../src/schemas';

describe('TenancySchema', () => {
  it('accepts a minimal valid tenancy', () => {
    const parsed = TenancySchema.parse({ Label: '6B-R6 Sun Peng' });
    expect(parsed.Label).toBe('6B-R6 Sun Peng');
  });

  it('rejects when Label is missing', () => {
    expect(() => TenancySchema.parse({})).toThrow();
  });

  it('accepts optional Monthly Rent and Due Day', () => {
    const parsed = TenancySchema.parse({
      Label: 'X',
      'Monthly Rent': 1650,
      'Due Day': 15,
    });
    expect(parsed['Monthly Rent']).toBe(1650);
    expect(parsed['Due Day']).toBe(15);
  });

  it('rejects Due Day above 28', () => {
    expect(() =>
      TenancySchema.parse({ Label: 'X', 'Due Day': 29 }),
    ).toThrow();
  });
});

describe('ChargeSchema', () => {
  it('accepts a minimal valid charge', () => {
    const parsed = ChargeSchema.parse({ Label: 'X 2026-05 Rent' });
    expect(parsed.Label).toBe('X 2026-05 Rent');
  });

  it('accepts linked Tenancy as array of strings', () => {
    const parsed = ChargeSchema.parse({
      Label: 'X',
      Tenancy: ['rec123'],
    });
    expect(parsed.Tenancy).toEqual(['rec123']);
  });
});

describe('PaymentSchema', () => {
  it('accepts a payment with Charge link and amount', () => {
    const parsed = PaymentSchema.parse({
      Label:  'Sun Peng 2026-04-25 $1,650.00',
      Charge: ['rec123'],
      Amount: 1650,
    });
    expect(parsed.Amount).toBe(1650);
  });
});
