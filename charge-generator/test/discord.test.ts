import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyDiscord } from '../src/discord';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('notifyDiscord', () => {
  it('returns true on 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));

    const ok = await notifyDiscord('http://x', '2026-05', ['A'], [], []);

    expect(ok).toBe(true);
  });

  it('uses red color when there are errors', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await notifyDiscord('http://x', '2026-05', [], [], ['boom']);

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.embeds[0].color).toBe(0xff4444);
  });

  it('uses green when only created and no errors', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await notifyDiscord('http://x', '2026-05', ['A'], [], []);

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.embeds[0].color).toBe(0x00c851);
  });

  it('uses yellow when nothing created and no errors', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await notifyDiscord('http://x', '2026-05', [], ['A'], []);

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.embeds[0].color).toBe(0xffbb33);
  });

  it('returns false on non-2xx without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));

    const ok = await notifyDiscord('http://x', '2026-05', ['A'], [], []);

    expect(ok).toBe(false);
  });

  it('returns false on network error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('down');
    }));

    const ok = await notifyDiscord('http://x', '2026-05', ['A'], [], []);

    expect(ok).toBe(false);
  });
});
