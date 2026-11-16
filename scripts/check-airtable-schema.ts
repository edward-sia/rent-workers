import { appendFileSync } from 'node:fs';
import { TABLES } from '../packages/airtable-client/src/tables';

interface AirtableField {
  id: string;
  name: string;
  type: string;
  options?: { choices?: { name: string }[] };
}

interface AirtableTable {
  id: string;
  name: string;
  fields: AirtableField[];
}

interface AirtableMetadataResponse {
  tables: AirtableTable[];
}

const REQUIRED_FIELDS = {
  [TABLES.TENANCIES]: {
    Label: ['singleLineText', 'formula'],
    'Monthly Rent': ['number', 'currency'],
    'Start Date': ['date'],
    'End Date': ['date'],
    'Due Day': ['number'],
    Balance: ['number', 'currency', 'rollup', 'formula'],
    Room: ['multipleRecordLinks'],
    Tenant: ['multipleRecordLinks'],
    Frequency: ['singleSelect'],
  },
  [TABLES.CHARGES]: {
    Label: ['singleLineText'],
    Period: ['singleLineText'],
    'Due Date': ['date'],
    Amount: ['number', 'currency'],
    Balance: ['number', 'currency', 'formula', 'rollup'],
    Status: ['singleSelect', 'formula'],
    Type: ['singleSelect', 'singleLineText'],
    Tenancy: ['multipleRecordLinks'],
  },
  [TABLES.PAYMENTS]: {
    Label: ['singleLineText'],
    Charge: ['multipleRecordLinks'],
    Amount: ['number', 'currency'],
    'Paid Date': ['date'],
    Method: ['singleSelect'],
    Notes: ['multilineText', 'singleLineText'],
  },
  [TABLES.ROOMS]: {
    Code: ['singleLineText'],
    'Default Rent': ['currency', 'number'],
    Status: ['singleSelect'],
  },
  [TABLES.TENANTS]: {
    Name: ['singleLineText'],
    Notes: ['multilineText', 'richText'],
  },
} as const satisfies Record<string, Record<string, readonly string[]>>;

// Options the workers write. A single select rejects a value it has no option for.
const REQUIRED_CHOICES: Record<string, Record<string, readonly string[]>> = {
  [TABLES.ROOMS]: { Status: ['Occupied', 'Vacant'] },
  [TABLES.TENANCIES]: { Frequency: ['Monthly'] },
  [TABLES.CHARGES]: { Type: ['Rent', 'Bond'] },
};

function isAirtableField(value: unknown): value is AirtableField {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'name' in value &&
      'type' in value &&
      typeof value.id === 'string' &&
      typeof value.name === 'string' &&
      typeof value.type === 'string',
  );
}

function isAirtableTable(value: unknown): value is AirtableTable {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'name' in value &&
      'fields' in value &&
      typeof value.id === 'string' &&
      typeof value.name === 'string' &&
      Array.isArray(value.fields) &&
      value.fields.every(isAirtableField),
  );
}

function isAirtableMetadataResponse(value: unknown): value is AirtableMetadataResponse {
  if (!value || typeof value !== 'object' || !('tables' in value)) {
    return false;
  }

  const { tables } = value;
  return Array.isArray(tables) && tables.every(isAirtableTable);
}

function findSchemaDrift(tables: AirtableTable[]): string[] {
  const tablesById = new Map(tables.map((table) => [table.id, table]));
  const problems: string[] = [];

  for (const [tableId, requiredFields] of Object.entries(REQUIRED_FIELDS)) {
    const table = tablesById.get(tableId);
    if (!table) {
      problems.push(`Table missing: ${tableId}`);
      continue;
    }

    const fieldsByName = new Map(table.fields.map((field) => [field.name, field]));
    for (const [fieldName, allowedTypes] of Object.entries(requiredFields)) {
      const field = fieldsByName.get(fieldName);
      if (!field) {
        problems.push(`[${table.name}] field missing: ${fieldName}`);
        continue;
      }

      if (!allowedTypes.includes(field.type)) {
        problems.push(
          `[${table.name}] field "${fieldName}" is type "${field.type}", expected one of: ${allowedTypes.join(', ')}`,
        );
      }

      // A text field takes any value, so only a single select needs its options checked.
      const requiredChoices = REQUIRED_CHOICES[tableId]?.[fieldName];
      if (requiredChoices && field.type === 'singleSelect') {
        const present = new Set((field.options?.choices ?? []).map((choice) => choice.name));
        for (const choice of requiredChoices) {
          if (!present.has(choice)) {
            problems.push(`[${table.name}] field "${fieldName}" missing option: ${choice}`);
          }
        }
      }
    }
  }

  return problems;
}

interface CheckResult {
  exitCode: 0 | 1 | 2;
  summary: string;
  problems?: string[];
}

async function checkSchema(): Promise<CheckResult> {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) {
    return { exitCode: 2, summary: 'Schema check configuration is missing.' };
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch {
    return { exitCode: 2, summary: 'Could not reach Airtable.' };
  }

  const status = `HTTP ${response.status}`;
  if (!response.ok) {
    return { exitCode: 2, summary: `${status}: Airtable metadata request failed.` };
  }

  try {
    const metadata: unknown = await response.json();
    if (isAirtableMetadataResponse(metadata)) {
      const problems = findSchemaDrift(metadata.tables);
      if (problems.length > 0) {
        return { exitCode: 1, summary: `${status}: Airtable schema drift detected.`, problems };
      }
      return { exitCode: 0, summary: `${status}: Airtable schema OK.` };
    }
  } catch {
    // Parsing and validation errors can contain upstream data.
  }
  return { exitCode: 2, summary: `${status}: Invalid Airtable metadata.` };
}

async function main(): Promise<void> {
  const result = await checkSchema();
  if (process.argv.includes('--github-actions')) {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error('GitHub Actions output is unavailable.');
    appendFileSync(output, `summary=${result.summary}\n`);
  } else {
    console.log(result.summary);
    for (const problem of result.problems ?? []) console.log(`  - ${problem}`);
  }
  process.exitCode = result.exitCode;
}

void main();
