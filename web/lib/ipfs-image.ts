import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** A CIDv0 (Qm…) or CIDv1 (b…) content id, and nothing that could escape a path. */
export const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;

/** The IPFS content id in a gateway URL such as https://ipfs.io/ipfs/<cid>, or null. */
export function cidOf(url: string): string | null {
  const m = /\/ipfs\/([A-Za-z0-9]+)/.exec(url);
  return m && CID.test(m[1]!) ? m[1]! : null;
}

/**
 * A token image as the site serves it: through its own /api/ipfs route, so no public gateway's
 * rate limit (ipfs.io answers 429 under load) can leave a token without its picture.
 */
export const tokenImage = (url: string): string => { const cid = cidOf(url); return cid ? `/api/ipfs/${cid}` : url; };

// Pinata first: launches pin there, so it is the fastest to have it.
const GATEWAYS = ["https://gateway.pinata.cloud/ipfs/", "https://dweb.link/ipfs/", "https://ipfs.io/ipfs/"];
const IMAGE = /^image\/(png|jpeg|gif|webp)$/;
const MAX = 2_000_000;

/** Kept beside the launch database, on the persistent volume; content-addressed, so never stale. */
const cacheDir = () => join(dirname(resolve(process.env.PUMP_LAUNCH_DB_PATH ?? ".data/launchpad.sqlite")), "ipfs");

/** The image for a content id: from the cache, else the first gateway that has it. Null if none does. */
export async function ipfsImage(cid: string): Promise<{ body: Buffer; type: string } | null> {
  if (!CID.test(cid)) return null;
  const file = join(cacheDir(), cid);
  try {
    const [body, type] = await Promise.all([readFile(file), readFile(`${file}.type`, "utf8")]);
    if (IMAGE.test(type)) return { body, type };
  } catch { /* not cached yet */ }
  for (const gateway of GATEWAYS) {
    try {
      const response = await fetch(gateway + cid, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
      const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
      if (!response.ok || !IMAGE.test(type)) continue;
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0 || body.length > MAX) continue;
      try { await mkdir(cacheDir(), { recursive: true }); await writeFile(file, body); await writeFile(`${file}.type`, type); } catch { /* serve it anyway */ }
      return { body, type };
    } catch { /* next gateway */ }
  }
  return null;
}
