// Attribution of long frames from a Chrome trace (hitch measurements, `hitches.spec.ts` with HITCH_TRACE=1): which GC
// ran and which functions the CPU sampler caught on the page's main thread inside every long frame. The page puts a
// `performance.mark(SYNC_MARK)` into the trace and reports its `performance.now()`, which aligns the two clocks.

export const SYNC_MARK = "hitch-sync";
/** Categories: main-thread tasks and GC, user timing (the sync mark), the V8 CPU sampler. */
export const TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing", "v8", "disabled-by-default-v8.gc", "disabled-by-default-v8.cpu_profiler"];
const TOP = 4;
const US_PER_MS = 1000;
const GC_NAME = /^(MinorGC|MajorGC|V8\.GC_|BlinkGC|V8\.GCScavenger|V8\.GCFinalizeMC|V8\.GCCompactor|V8\.GCIncrementalMarking)/;
/** Game code is served from these paths by the Vite dev server. */
const APP_CODE = /\/(src|dev)\//;

interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  id?: string;
  args?: { name?: string; data?: { startTime?: number; cpuProfile?: { nodes?: ProfileNode[]; samples?: number[] }; timeDeltas?: number[] } };
}

interface ProfileNode {
  id: number;
  parent?: number;
  /** Trace profiles leave out `url` (and `functionName`) of native frames. */
  callFrame: { functionName?: string; url?: string; lineNumber?: number };
}

export interface FrameAttribution {
  /** GC on the main thread inside the frame (ms). */
  gcMs: number;
  gc: string[];
  /** Functions with the most samples (self time), ms estimated from the sample count. */
  self: { fn: string; ms: number }[];
  /** The innermost game function on the sampled stacks (what game code was running). */
  app: { fn: string; ms: number }[];
}

/** A sample: when (trace µs) and the profile node that was on top of the stack. */
interface Sample {
  ts: number;
  node: number;
}

export class TraceAttribution {
  private readonly offsetUs: number;
  private readonly gcEvents: TraceEvent[];
  private readonly samples: Sample[] = [];
  private readonly nodes = new Map<number, ProfileNode>();
  private readonly sampleUs: number;

  /** `syncNow` = the page's `performance.now()` when it put `SYNC_MARK` into the trace. */
  constructor(trace: { traceEvents: TraceEvent[] } | TraceEvent[], syncNow: number) {
    const events = Array.isArray(trace) ? trace : trace.traceEvents;
    const mark = events.find((e) => e.name === SYNC_MARK && e.cat.includes("user_timing"));
    if (mark === undefined) throw new Error("the trace has no sync mark");
    this.offsetUs = mark.ts - syncNow * US_PER_MS;
    const main = events.find((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain" && e.pid === mark.pid);
    const tid = main?.tid ?? mark.tid;
    this.gcEvents = events.filter((e) => e.pid === mark.pid && e.tid === tid && e.ph === "X" && GC_NAME.test(e.name) && (e.dur ?? 0) > 0);
    // CPU profile chunks of the page's main-thread isolate (one profile per `Profile` event id).
    const profiles = new Map<string, { start: number; ts: number }>();
    for (const e of events) if (e.name === "Profile" && e.pid === mark.pid && e.id !== undefined) profiles.set(e.id, { start: e.args?.data?.startTime ?? e.ts, ts: e.args?.data?.startTime ?? e.ts });
    for (const e of events) {
      if (e.name !== "ProfileChunk" || e.pid !== mark.pid || e.id === undefined) continue;
      const profile = profiles.get(e.id);
      const data = e.args?.data;
      if (profile === undefined || data === undefined) continue;
      for (const node of data.cpuProfile?.nodes ?? []) this.nodes.set(node.id, node);
      const samples = data.cpuProfile?.samples ?? [];
      const deltas = data.timeDeltas ?? [];
      for (let i = 0; i < samples.length; i++) {
        profile.ts += deltas[i] ?? 0;
        this.samples.push({ ts: profile.ts, node: samples[i]! });
      }
    }
    this.samples.sort((a, b) => a.ts - b.ts);
    const span = this.samples.length > 1 ? this.samples[this.samples.length - 1]!.ts - this.samples[0]!.ts : 0;
    this.sampleUs = this.samples.length > 1 ? span / (this.samples.length - 1) : 0;
  }

  /** What ran between `fromMs` and `toMs` (page `performance.now()`). */
  frame(fromMs: number, toMs: number): FrameAttribution {
    const from = fromMs * US_PER_MS + this.offsetUs;
    const to = toMs * US_PER_MS + this.offsetUs;
    let gcUs = 0;
    const gc: string[] = [];
    for (const e of this.gcEvents) {
      const end = e.ts + (e.dur ?? 0);
      if (end < from || e.ts > to) continue;
      const overlap = Math.min(end, to) - Math.max(e.ts, from);
      gcUs += overlap;
      gc.push(`${e.name} ${(overlap / US_PER_MS).toFixed(1)}`);
    }
    const self = new Map<string, number>();
    const app = new Map<string, number>();
    for (const s of this.samplesIn(from, to)) {
      const node = this.nodes.get(s.node);
      if (node === undefined) continue;
      const key = TraceAttribution.label(node);
      self.set(key, (self.get(key) ?? 0) + 1);
      const appNode = this.appFrame(node);
      const appKey = appNode === null ? "(no game code)" : TraceAttribution.label(appNode);
      app.set(appKey, (app.get(appKey) ?? 0) + 1);
    }
    const top = (m: Map<string, number>): { fn: string; ms: number }[] =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP)
        .map(([fn, n]) => ({ fn, ms: Math.round((n * this.sampleUs) / 100) / 10 }));
    return { gcMs: Math.round(gcUs / 100) / 10, gc, self: top(self), app: top(app) };
  }

  /** Total GC time on the main thread over the whole trace (ms) and the longest single GC (ms). */
  gcSummary(): { totalMs: number; longestMs: number; count: number } {
    let total = 0;
    let longest = 0;
    for (const e of this.gcEvents) {
      total += e.dur ?? 0;
      longest = Math.max(longest, e.dur ?? 0);
    }
    return { totalMs: Math.round(total / 100) / 10, longestMs: Math.round(longest / 100) / 10, count: this.gcEvents.length };
  }

  private *samplesIn(from: number, to: number): Generator<Sample> {
    let lo = 0;
    let hi = this.samples.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid]!.ts < from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.samples.length && this.samples[i]!.ts <= to; i++) yield this.samples[i]!;
  }

  private appFrame(node: ProfileNode): ProfileNode | null {
    let current: ProfileNode | undefined = node;
    while (current !== undefined) {
      if (APP_CODE.test(current.callFrame.url ?? "")) return current;
      current = current.parent === undefined ? undefined : this.nodes.get(current.parent);
    }
    return null;
  }

  private static label(node: ProfileNode): string {
    const f = node.callFrame;
    const file = (f.url ?? "").split("/").pop()?.split("?")[0] ?? "";
    return `${f.functionName || "(anonymous)"}${file === "" ? "" : ` ${file}:${(f.lineNumber ?? 0) + 1}`}`;
  }
}
