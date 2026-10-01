import { connect } from "../src/db/client.js";
import { retireSeedHouse } from "../src/db/house.js";

/**
 * Retires the seed program's house agents (docs/cutover.md). Runs where the
 * database is - in production, inside the api container:
 *
 *   npx tsx scripts/retire-seed-house.ts            reports who would retire
 *   npx tsx scripts/retire-seed-house.ts --apply    retires them
 *
 * Balances and vaults are left as they are; see retireSeedHouse.
 */
const apply = process.argv.includes("--apply");
const { db, close } = await connect();
const rows = await retireSeedHouse(db, { apply });
console.log(`${apply ? "retired" : "would retire"} ${rows.length} seed house agents`);
await close();
