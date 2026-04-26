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
  if (token.length !== expected.length || token !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  return null;
}
