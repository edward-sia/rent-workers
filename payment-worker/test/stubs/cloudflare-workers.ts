/** Node stand-in for `cloudflare:workers`, so unit tests can import modules that use it. */
export class DurableObject {
  constructor(
    protected ctx: unknown,
    protected env: unknown,
  ) {}
}
