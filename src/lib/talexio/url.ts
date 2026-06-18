/**
 * Resolve the Talexio GraphQL endpoint.
 *
 * Talexio's GraphQL lives at the `/graphql` path. Posting a query to the bare
 * host instead returns a misleading `"Please select at least one payroll"`
 * error (it's a different handler), which previously sent us chasing a
 * non-existent payroll-selection problem. This helper guarantees the `/graphql`
 * suffix regardless of how the env var is set, so a bare-host value can't
 * silently break the token verifier and diagnostic routes again.
 *
 * Defaults to the same endpoint the working sync hardcodes
 * (`https://api.talexiohr.com/graphql`) when the env var is unset.
 */
export function graphqlUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_TALEXIOHR_API_URL ?? 'https://api.talexiohr.com/graphql').trim()
  const noTrailingSlash = raw.replace(/\/+$/, '')
  return /\/graphql$/.test(noTrailingSlash) ? noTrailingSlash : `${noTrailingSlash}/graphql`
}
