/**
 * `scripts/db/yodel.sh sql`: run the SQL on stdin (yodel.sh passes it as
 * SQL_IN) as the writer, outside yodel, the way an operator's psql session
 * would make an out-of-band change. The claims use it to make the live schema
 * differ from the declared one. Credentials come from the environment, never
 * argv; SSL follows the URL (./connection.ts).
 */
import pg from "pg";
import { clientConfig } from "./connection";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`db sql: ${name} is not set (scripts/db/yodel.sh sets it)`);
  return v;
}

async function main(): Promise<void> {
  const client = new pg.Client(clientConfig(need("LOOM_YODEL_URL"), need("LOOM_DB_WRITER_USER"), need("LOOM_DB_WRITER_PASSWORD")));
  await client.connect();
  try {
    const result = await client.query(need("SQL_IN"));
    for (const res of ([] as pg.QueryResult[]).concat(result)) if (res.rows?.length) console.log(JSON.stringify(res.rows));
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: Error) => {
    console.error(`db sql: ${err.message}`);
    process.exit(1);
  });
}
