export const TABLES = {
  TENANCIES: 'tblvVmo12VikITRH6',
  CHARGES:   'tblNCw6ZxspNxiKCu',
  PAYMENTS:  'tbl8Zl9C9fzBDPllu',
  TENANTS:   'tblsesIqj1VuokNcP',
  ROOMS:     'tblBrzawaTuwahBQg',
} as const;

export type TableId = typeof TABLES[keyof typeof TABLES];
