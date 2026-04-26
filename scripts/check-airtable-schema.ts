import { TABLES } from '../packages/airtable-client/src/tables';

interface AirtableField {
  id: string;
  name: string;
  type: string;
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
} as const satisfies Record<string, Record<string, readonly string[]>>;

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

async function fetchSchema(token: string, baseId: string): Promise<AirtableMetadataResponse> {
  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) {
    throw new Error(`Schema fetch failed: ${response.status} ${await response.text()}`);
  }

  const data: unknown = await response.json();
  if (!isAirtableMetadataResponse(data)) {
    throw new Error('Schema fetch failed: unexpected metadata response shape');
  }

  return data;
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
    }
  }

  return problems;
}

async function main(): Promise<void> {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!token || !baseId) {
    console.error('Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID');
    process.exit(2);
  }

  let metadata: AirtableMetadataResponse;
  try {
    metadata = await fetchSchema(token, baseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(2);
  }

  const problems = findSchemaDrift(metadata.tables);
  if (problems.length > 0) {
    console.log('Schema drift detected:');
    for (const problem of problems) {
      console.log(`  - ${problem}`);
    }
    process.exit(1);
  }

  console.log('Airtable schema OK');
}

void main();
