import type { WizardSession } from './types';

const sessionKey = (userId: number): string => `session:${userId}`;

export async function getSession(userId: number, kv: KVNamespace): Promise<WizardSession> {
  const raw = await kv.get(sessionKey(userId));
  return raw ? (JSON.parse(raw) as WizardSession) : { step: 'idle' };
}

export async function setSession(
  userId: number,
  session: WizardSession,
  kv: KVNamespace,
): Promise<void> {
  await kv.put(sessionKey(userId), JSON.stringify(session), { expirationTtl: 3600 });
}

export async function clearSession(userId: number, kv: KVNamespace): Promise<void> {
  await kv.delete(sessionKey(userId));
}
