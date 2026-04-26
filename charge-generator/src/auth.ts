export function requireBearer(request: Request, expected: string): Response | null {
  if (!expected || expected.length < 16) {
    return new Response('Unauthorized', { status: 401 });
  }

  const auth = request.headers.get('Authorization') ?? '';
  const prefix = 'Bearer ';
  if (!auth.startsWith(prefix)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const token = auth.slice(prefix.length);
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
