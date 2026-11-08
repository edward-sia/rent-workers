/**
 * A Bond charge has no `Period`. The charge generator treats any charge with next month's
 * `Period` as that month's rent and skips the tenancy, so a bond with a Period could stop
 * a rent charge being created.
 */
export interface BondChargeFields {
  Label: string;
  Tenancy: string[];
  Type: 'Bond';
  'Due Date': string;
  Amount: number;
}

/** The bond the bot suggests at move-in: one month of rent. The operator can change it. */
export function suggestedBond(monthlyRent: number): number {
  return monthlyRent;
}

export function buildBondCharge(input: {
  tenancyId: string;
  tenancyLabel: string;
  dueDate: string;
  amount: number;
}): BondChargeFields {
  return {
    Label: `${input.tenancyLabel} Bond`,
    Tenancy: [input.tenancyId],
    Type: 'Bond',
    'Due Date': input.dueDate,
    Amount: input.amount,
  };
}
