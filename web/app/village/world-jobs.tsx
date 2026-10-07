"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Observation only: residents accept jobs themselves; there are no player controls or rewards. */
export function WorldJobs() {
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof api.worldJobs>>["jobs"] | null>(null);
  const [now, setNow] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    const read = () => api.worldJobs().then((r) => {
      if (!gone) { setJobs(r.jobs); setFailed(false); setNow(Date.now()); }
    }, () => { if (!gone) setFailed(true); });
    void read();
    const poll = setInterval(read, 30_000);
    const clock = setInterval(() => setNow(Date.now()), 10_000);
    return () => { gone = true; clearInterval(poll); clearInterval(clock); };
  }, []);
  const current = jobs?.filter((job) => job.expiresAt > now) ?? [];
  return <section className="mt-4 rounded-panel border border-line px-3 py-3" aria-label="World jobs">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Town errands</h3>
    <p className="mt-1 text-xs leading-5 text-muted">Agents choose these jobs autonomously. Just for fun—only Bluff &amp; Fold earns rewards.</p>
    {failed ? <p role="status" className="mt-2 text-xs text-muted">Jobs are temporarily unavailable. Retrying…</p> : !jobs ? <p role="status" className="mt-2 text-xs text-muted">Reading the board…</p> : !current.length ? <p className="mt-2 text-xs text-muted">The next notices are being posted.</p> :
      <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs">
        {current.map((job) => <li key={job.id} className="border-t border-line pt-2">
          <p>{job.title}</p>
          <p className="mt-1 text-muted">{job.accepted} / {job.capacity} accepted · expires in {Math.max(1, Math.ceil((job.expiresAt - now) / 60_000))} min</p>
        </li>)}
      </ul>}
  </section>;
}
