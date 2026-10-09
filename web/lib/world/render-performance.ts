/** Opt-in render diagnostics. Disabled on ordinary production routes; bounded history. */
export type RenderSample = { at: number; ms: number; interval: number; stages: Record<string, number>; counts: Record<string, number> };
export const worldPerformance = {
  enabled: false,
  frames: [] as RenderSample[],
  totals: {} as Record<string, number>,
  current: null as RenderSample | null,
  started: 0,
  previous: 0,
  get summary() {
    const recent=this.frames.slice(-30),last=recent.at(-1),first=recent[0];
    const duration=last&&first?last.at-first.at:0;
    return {fps:duration>0?(recent.length-1)*1000/duration:0,
      frameMs:last?.ms??0,visibleObjects:last?.counts.visibleObjects??0,
      activeAgents:last?.counts.activeAgents??0,directionalAssetSwitches:0,
      canvasCreates:this.totals.canvasCreates??0,textureDecodes:this.totals.textureDecodes??0,
      reactRenders:this.totals.reactRenders??0};
  },
  begin(at: number) {
    if (!this.enabled) return;
    this.started = performance.now();
    this.current = { at, ms: 0, interval: this.previous ? at-this.previous : 0, stages: {}, counts: {} };
    this.previous = at;
  },
  count(name: string, amount = 1) {
    if (!this.enabled) return;
    this.totals[name] = (this.totals[name] ?? 0) + amount;
    if (this.current) this.current.counts[name] = (this.current.counts[name] ?? 0) + amount;
  },
  start() { return this.enabled ? performance.now() : 0; },
  endStage(name: string, started: number) {
    if (!this.enabled || !started || !this.current) return;
    this.current.stages[name] = (this.current.stages[name] ?? 0) + performance.now()-started;
  },
  end() {
    if (!this.enabled || !this.current) return;
    this.current.ms = performance.now()-this.started;
    this.frames.push(this.current);
    if (this.frames.length > 600) this.frames.shift();
    this.current = null;
  },
};
