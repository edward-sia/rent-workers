import { z } from 'zod';

export const TenancySchema = z.object({
  Label:          z.string(),
  'Monthly Rent': z.number().optional(),
  'Start Date':   z.string().optional(),
  'End Date':     z.string().optional(),
  'Due Day':      z.number().int().min(1).max(28).optional(),
  Balance:        z.number().optional(),
});
export type Tenancy = z.infer<typeof TenancySchema>;

export const ChargeSchema = z.object({
  Label:      z.string(),
  Period:     z.string().optional(),
  'Due Date': z.string().optional(),
  Amount:     z.number().optional(),
  Balance:    z.number().optional(),
  Status:     z.enum(['Unpaid', 'Partial', 'Paid', 'Overdue']).optional(),
  Type:       z.string().optional(),
  Tenancy:    z.array(z.string()).optional(),
});
export type Charge = z.infer<typeof ChargeSchema>;

export const PaymentSchema = z.object({
  Label:       z.string(),
  Charge:      z.array(z.string()).optional(),
  Amount:      z.number().optional(),
  'Paid Date': z.string().optional(),
  Method:      z.string().optional(),
  Notes:       z.string().optional(),
});
export type Payment = z.infer<typeof PaymentSchema>;
