// Runs before `next start` (package.json): keeps earlier builds' code files servable after a deploy.
//
// Next names each code file by its contents and a deploy ships only the new build's, so a tab opened
// before the deploy asks for files the new server no longer has - and shows "This page couldn't load"
// the next time it needs one (a ChunkLoadError). Each build's files are kept on the service's
// persistent volume and put back beside the new build's at start: names never collide, and an old
// tab keeps working until it next loads a page. Files no build has used for a week are dropped.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { join, relative } from "node:path";

const volume = process.env.STATIC_ARCHIVE_DIR ?? (process.env.RAILWAY_VOLUME_MOUNT_PATH ? join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "next-static") : null);
const built = join(process.cwd(), ".next", "static");
const WEEK = 7 * 24 * 60 * 60 * 1000;

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
}

try {
  if (!volume || !existsSync(built)) {
    console.log("keep-static: no volume or no build; skipped");
  } else {
    mkdirSync(volume, { recursive: true });
    const now = new Date();
    let saved = 0, restored = 0, pruned = 0;
    // This build's files into the archive, each marked as used now.
    for (const file of files(built)) {
      const target = join(volume, relative(built, file));
      if (!existsSync(target)) { mkdirSync(join(target, ".."), { recursive: true }); cpSync(file, target); saved++; }
      utimesSync(target, now, now);
    }
    // Earlier builds' files back beside this one's, unless no build has used them for a week.
    for (const file of files(volume)) {
      if (now.getTime() - statSync(file).mtimeMs > WEEK) { rmSync(file); pruned++; continue; }
      const target = join(built, relative(volume, file));
      if (!existsSync(target)) { mkdirSync(join(target, ".."), { recursive: true }); cpSync(file, target); restored++; }
    }
    console.log(`keep-static: ${saved} new files kept, ${restored} earlier files restored, ${pruned} week-old files dropped`);
  }
} catch (error) {
  // Never stop the site from starting over this: at worst, old tabs reload (app/error.tsx).
  console.log(`keep-static: skipped (${error.message})`);
}
