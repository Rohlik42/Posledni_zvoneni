/**
 * Reasons a frame may run long (FEEDBACK 2026-10-04 „občas se to sekne, jak se něco předpočítává“): systems that do
 * occasional heavy work call `FrameTags.note(tag)` in the frame that does it (a shader warm-up, a shadow map swap, a
 * quality step, a lazily built cache, a room change…). `PerfMonitor` attaches the tags of a frame to it when the frame
 * turns out to be a hitch and clears them every frame, so the F3 panel and `__game.perf.longFrames()` can say why a frame
 * was long. A static list: one game per page. Tags are short constant strings (no allocation per call beyond the first).
 */
export class FrameTags {
  private static readonly current: string[] = [];

  /** Notes that this frame did `tag` (deduplicated within the frame). */
  static note(tag: string): void {
    if (!FrameTags.current.includes(tag)) FrameTags.current.push(tag);
  }

  /** The tags noted since the last `take` (the array is reused; copy it to keep it). */
  static peek(): readonly string[] {
    return FrameTags.current;
  }

  static clear(): void {
    FrameTags.current.length = 0;
  }
}
