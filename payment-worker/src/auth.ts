export function requireWebhookSecret(request: Request, expected: string): Response | null {
  if (!expected || expected.length < 16) {
    return new Response('Unauthorized', { status: 401 });
  }

  const token = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (token.length !== expected.length || !sameToken(token, expected)) {
    return new Response('Unauthorized', { status: 401 });
  }

  return null;
}

function sameToken(actual: string, expected: string): boolean {
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
