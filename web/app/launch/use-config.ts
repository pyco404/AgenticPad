"use client";

import { useEffect, useState } from "react";
import { launchpad, type LaunchpadConfig } from "@/lib/launchpad";

/** The launchpad's settings, read once per page; null until they arrive. */
export function useLaunchConfig(): { config: LaunchpadConfig | null; error: string | null } {
  const [config, setConfig] = useState<LaunchpadConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    launchpad.getConfig().then(
      (c) => !gone && setConfig(c),
      (e: Error) => !gone && setError(e.message),
    );
    return () => {
      gone = true;
    };
  }, []);
  return { config, error };
}
