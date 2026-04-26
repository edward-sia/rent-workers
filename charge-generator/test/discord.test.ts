import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyDiscord } from '../src/discord';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sentEmbed(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(call[1].body as string).embeds[0] as { color: number };
}

describe('notifyDiscord', () => {
  it('returns true on 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));

    const ok = await notifyDiscord('http://x', '2026-05', ['recA'], [], []);

    expect(ok).toBe(true);
  });

  it('uses red color when there are errors', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await notifyDiscord('http://x', '2026-05', [], [], ['tenancy recA: Airtable create failed']);

    expect(sentEmbed(fetchMock).color).toBe(0xff4444);
  });

  it('uses green when only created and no errors', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await notifyDiscord('http://x', '2026-05', ['recA'], [], []);

    expect(sentEmbed(fetchMock).color).toBe(0x00c851);
  });

  it('uses yellow when nothing created and no errors', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await notifyDiscord('http://x', '2026-05', [], ['recA'], []);

    expect(sentEmbed(fetchMock).color).toBe(0xffbb33);
  });

  it('returns false on non-2xx without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('tenant upstream details', { status: 502 })));

    const ok = await notifyDiscord('http://x', '2026-05', ['recA'], [], []);

    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith('[Discord] webhook failed: status=502');
    expect(errorSpy.mock.calls.flat().join('\n')).not.toContain('tenant upstream details');
  });

  it('returns false on network error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('down');
    }));

    const ok = await notifyDiscord('http://x', '2026-05', ['recA'], [], []);

    expect(ok).toBe(false);
  });
});
