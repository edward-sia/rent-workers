import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../check-airtable-schema.ts', import.meta.url));

function runCheck(fetchBody: string, token = 'test-token', actions = true) {
  const dir = mkdtempSync(join(tmpdir(), 'schema-check-'));
  try {
    const output = join(dir, 'output');
    writeFileSync(output, '');
    const mock = 'data:text/javascript,' + encodeURIComponent('globalThis.fetch = async () => { ' + fetchBody + ' };');
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', '--import', mock, script, ...(actions ? ['--github-actions'] : []),
    ], {
      encoding: 'utf8',
      env: { ...process.env, AIRTABLE_TOKEN: token, AIRTABLE_BASE_ID: 'test-base', GITHUB_OUTPUT: output },
    });
    if (result.error) throw result.error;
    return { status: result.status, logs: result.stdout + result.stderr, output: readFileSync(output, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('schema-check reporting', () => {
  it.each([
    ['return new Response("PRIVATE_BODY", {status: 403, statusText: "PRIVATE_REASON"})', 2, 'HTTP 403: Airtable metadata request failed.'],
    ['return new Response("PRIVATE_JSON")', 2, 'HTTP 200: Invalid Airtable metadata.'],
    ['return Response.json({tables: "PRIVATE_SCHEMA"})', 2, 'HTTP 200: Invalid Airtable metadata.'],
    ['throw new Error("PRIVATE_NETWORK_ERROR")', 2, 'Could not reach Airtable.'],
    ['return Response.json({tables: []})', 1, 'HTTP 200: Airtable schema drift detected.'],
  ] as const)('publishes only the approved summary for %s', (mock, status, message) => {
    const result = runCheck(mock);
    expect(result.status).toBe(status);
    expect(result.output).toBe(`summary=${message}\n`);
    expect(result.logs).toBe('');
  });

  it('reports a configuration failure without an HTTP status', () => {
    const result = runCheck('throw new Error("fetch should not run")', '');
    expect(result).toEqual({ status: 2, logs: '', output: 'summary=Schema check configuration is missing.\n' });
  });

  it('preserves detailed drift diagnostics for local runs', () => {
    const result = runCheck('return Response.json({tables: []})', 'test-token', false);
    expect(result.status).toBe(1);
    expect(result.logs).toContain('Table missing:');
    expect(result.output).toBe('');
  });
});
