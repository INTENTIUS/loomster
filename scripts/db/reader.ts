/**
 * Create (or bring up to date) the read-only Postgres user SQL Yodeler plans,
 * reports status and watches drift with (loomster#78). Runs as the writer,
 * the master user, against the URL scripts/db/yodel.sh resolves, and is safe
 * to run again: the role's password is reset to the one in the reader secret
 * and every grant is re-issued.
 *
 * The reader can log in, read Loom's tables in `public` and yodel's history in
 * `yodeler`, and nothing else: its sessions default to read-only
 * transactions, and it owns nothing. Default privileges give it SELECT on
 * tables the writer creates later (a migration's new table, yodel's history
 * table), so a migration never has to grant it anything.
 *
 *   LOOM_YODEL_URL=postgres://host:port/db LOOM_DB_WRITER_USER=... \
 *   LOOM_DB_WRITER_PASSWORD=... LOOM_DB_READER_USER=... \
 *   LOOM_DB_READER_PASSWORD=... npx tsx scripts/db/reader.ts
 */
import pg from "pg";
import { clientConfig, databaseOf } from "./connection";

export const HISTORY_SCHEMA = "yodeler";
export const READ_SCHEMAS = ["public", HISTORY_SCHEMA];

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The statements that make `reader` a read-only user of `database`, as `writer`. Exported for the unit test. */
export function readerStatements(database: string, reader: string, password: string, writer: string): string[] {
  const r = quoteIdent(reader);
  const w = quoteIdent(writer);
  return [
    // CREATE ROLE has no IF NOT EXISTS; create it once, then always reset the password.
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(reader)}) THEN CREATE ROLE ${r} LOGIN; END IF; END $$`,
    `ALTER ROLE ${r} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${quoteLiteral(password)}`,
    `ALTER ROLE ${r} SET default_transaction_read_only = on`,
    `GRANT CONNECT ON DATABASE ${quoteIdent(database)} TO ${r}`,
    // yodel creates its history schema on the first write; create it now so the grants have something to land on.
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(HISTORY_SCHEMA)}`,
    ...READ_SCHEMAS.flatMap((s) => [
      `GRANT USAGE ON SCHEMA ${quoteIdent(s)} TO ${r}`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA ${quoteIdent(s)} TO ${r}`,
      `GRANT SELECT ON ALL SEQUENCES IN SCHEMA ${quoteIdent(s)} TO ${r}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${w} IN SCHEMA ${quoteIdent(s)} GRANT SELECT ON TABLES TO ${r}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${w} IN SCHEMA ${quoteIdent(s)} GRANT SELECT ON SEQUENCES TO ${r}`,
    ]),
  ];
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`reader: ${name} is not set (scripts/db/yodel.sh sets it)`);
  return v;
}

async function main(): Promise<void> {
  const url = need("LOOM_YODEL_URL");
  const database = databaseOf(url);
  const writer = need("LOOM_DB_WRITER_USER");
  const reader = need("LOOM_DB_READER_USER");
  if (reader === writer) throw new Error("reader: the reader and the writer are the same user");
  // SSL as the URL says: yodel.sh asks for it on AWS, where RDS requires it (./connection.ts).
  const client = new pg.Client(clientConfig(url, writer, need("LOOM_DB_WRITER_PASSWORD")));
  await client.connect();
  try {
    for (const sql of readerStatements(database, reader, need("LOOM_DB_READER_PASSWORD"), writer)) await client.query(sql);
  } finally {
    await client.end();
  }
  console.log(`reader: ${reader} reads ${READ_SCHEMAS.join(" and ")} in ${database}, read-only`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
