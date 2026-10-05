import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { LaunchForm } from "./launchpad";
// Node 24 provides this builtin directly. Avoid createRequire for builtins:
// Turbopack treats a URL-based commonjs external as unsupported.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

export type StoredLaunch = {
  id: string; owner: string; createdAt: number; form: LaunchForm; mint: string;
  uri: string; imageUrl: string; transaction: string; lastValidBlockHeight: number;
  signature: string | null; signed: string | null; confirmed: boolean;
  failure: string | null;
};

export class LaunchStore {
  readonly db: InstanceType<typeof DatabaseSync>;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS launches (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at INTEGER NOT NULL,
      mint TEXT NOT NULL UNIQUE, data TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS launches_owner ON launches(owner, created_at);
    CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  }
  get(id: string): StoredLaunch | null {
    const row = this.db.prepare("SELECT data FROM launches WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as StoredLaunch : null;
  }
  getMint(mint: string): StoredLaunch | null {
    const row = this.db.prepare("SELECT data FROM launches WHERE mint = ?").get(mint) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as StoredLaunch : null;
  }
  reserve(id: string, owner: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now();
      const recent = this.db.prepare("SELECT count(*) AS n FROM reservations WHERE owner = ? AND created_at > ?").get(owner, now - 600_000) as { n: number };
      if (recent.n >= 3) throw new Error("Too many launch preparations. Try again in 10 minutes.");
      const existing = this.db.prepare("SELECT id FROM reservations WHERE id = ?").get(id);
      if (existing) throw new Error("This launch is already being prepared. Please wait and retry.");
      this.db.prepare("DELETE FROM reservations WHERE created_at < ? AND id NOT IN (SELECT id FROM launches)").run(now - 86_400_000);
      this.db.prepare("INSERT INTO reservations (id, owner, created_at) VALUES (?, ?, ?)").run(id, owner, now);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  insert(launch: StoredLaunch): void {
    this.db.prepare("INSERT INTO launches (id, owner, created_at, mint, data) VALUES (?, ?, ?, ?, ?)").run(launch.id, launch.owner, launch.createdAt, launch.mint, JSON.stringify(launch));
  }
  save(launch: StoredLaunch): void {
    this.db.prepare("UPDATE launches SET data = ? WHERE id = ?").run(JSON.stringify(launch), launch.id);
  }
  list(): StoredLaunch[] {
    return (this.db.prepare("SELECT data FROM launches ORDER BY created_at DESC").all() as { data: string }[]).map((row) => JSON.parse(row.data) as StoredLaunch);
  }
}

let cached: LaunchStore | undefined;
export function launchStore(): LaunchStore {
  return cached ??= new LaunchStore(process.env.PUMP_LAUNCH_DB_PATH ?? resolve(process.cwd(), ".data/launchpad.sqlite"));
}
