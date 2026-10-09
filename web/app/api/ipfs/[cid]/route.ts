import { ipfsImage } from "@/lib/ipfs-image";

export const runtime = "nodejs";

/** A launched token's image, served from the site's own cache (lib/ipfs-image.ts). */
export async function GET(_request: Request, context: { params: Promise<{ cid: string }> }) {
  const { cid } = await context.params;
  const image = await ipfsImage(cid);
  if (!image) return new Response("Image unavailable", { status: 404, headers: { "cache-control": "public, max-age=60" } });
  // Content-addressed: the bytes for a content id never change.
  return new Response(new Uint8Array(image.body), { headers: { "content-type": image.type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}
