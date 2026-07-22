import type { Pool, QueryResult, QueryResultRow } from "pg";

export type QueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/**
 * Bind a query helper to a host-provided pool — the single place core touches pg. Everything
 * downstream takes this `query` fn, so core never owns a connection or reads a connection string.
 * Never string-concatenate user input into `text`; pass values as `params`.
 */
export function createDb(pool: Pool): { query: QueryFn } {
  return {
    query: <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) =>
      pool.query<T>(text, params),
  };
}
