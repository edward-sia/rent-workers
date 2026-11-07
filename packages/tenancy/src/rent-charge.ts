export interface RentChargeFields {
  Label: string;
  Tenancy: string[];
  Type: 'Rent';
  Period: string;
  'Due Date': string;
  Amount: number;
}

export function buildRentCharge(input: {
  tenancyId: string;
  tenancyLabel: string;
  period: string;
  dueDate: string;
  amount: number;
}): RentChargeFields {
  return {
    Label: `${input.tenancyLabel} ${input.period} Rent`,
    Tenancy: [input.tenancyId],
    Type: 'Rent',
    Period: input.period,
    'Due Date': input.dueDate,
    Amount: input.amount,
  };
}
