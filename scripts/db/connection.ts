/**
 * How loomster's own Postgres clients (scripts/db/reader.ts, scripts/db/sql.ts)
 * connect to the URL scripts/db/yodel.sh resolves, the same way SQL Yodeler
 * does: the URL is the connection string, credentials go into it, and its
 * query parameters decide SSL.
 *
 * On AWS the URL carries AWS_SSL_QUERY. RDS for PostgreSQL refuses a
 * connection without SSL (`rds.force_ssl`: "no pg_hba.conf entry ... no
 * encryption"), and the connection reaches it through the SSM tunnel as
 * 127.0.0.1, a name the server's certificate can't match. So it asks for
 * libpq's `require`: encrypted, no certificate check (the tunnel itself is
 * SSM's authenticated session). node-postgres reads a bare `sslmode=require`
 * as verify-full, which would fail on the hostname; `uselibpqcompat=true`
 * gives libpq's meaning. Floci's RDS has no SSL, and its URL carries none.
 */
import type pg from "pg";

/** The query string yodel.sh adds to an AWS database's URL. */
export const AWS_SSL_QUERY = "uselibpqcompat=true&sslmode=require";

/** `url` with `user` and `password` in it, query parameters kept. */
export function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  return u.toString();
}

/** A node-postgres client config for `url` as `user`: SSL as the URL says. */
export function clientConfig(url: string, user: string, password: string): pg.ClientConfig {
  return { connectionString: withCredentials(url, user, password) };
}

/** The database `url` names. */
export function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}
