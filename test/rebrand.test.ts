import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await connect());
  await migrate(db);
}, 30_000);
afterAll(async () => { if (close) await close(); });

it("preserves applied migrations from a previous deployment instead of replaying them", async () => {
  await db.execute(sql.raw("ALTER TABLE agenticpad_migrations RENAME TO oxude_migrations"));
  const before = await db.execute(sql.raw("SELECT count(*)::int AS n FROM oxude_migrations")) as unknown as { rows: { n: number }[] };
  expect(before.rows[0]!.n).toBeGreaterThan(0);
  await migrate(db); // Replaying migration 0000 would fail on existing tables.
  const after = await db.execute(sql.raw("SELECT count(*)::int AS n FROM agenticpad_migrations")) as unknown as { rows: { n: number }[] };
  expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  await migrate(db); // A second restart is also safe with both ledgers present.
});
