import { AudioConfig, BEATS_PER_BAR, REST, type InstrumentData, type MusicData } from "./AudioConfig";
import type { SynthSounds } from "./SynthSounds";

const SECONDS_PER_MINUTE = 60;
const A4_MIDI = 69;
const A4_HZ = 440;
const SEMITONES_PER_OCTAVE = 12;
/** Envelope of a note: attack (s) and the level it decays to at the end of its gate. */
const NOTE_ATTACK = 0.005;
const NOTE_FLOOR = 0.001;
/** The oscillator runs this much past the end of its envelope (s). */
const NOTE_TAIL = 0.02;
/** First step starts this long after the scheduler starts (s). */
const START_DELAY = 0.05;

/**
 * A short chiptune loop from its own step sequencer (PLAN phase 20 „procedurální sekvencer na Web Audio“, no Tone.js):
 * `data/audio.json → music` holds the tempo, the patterns (bass and lead as semitones, drums as letters of the kit) and
 * the order of the bars. Notes are scheduled `lookahead` seconds ahead on the context clock every `tickMs`: square /
 * triangle oscillators with a short envelope for bass and lead, synthesized drum buffers from data/sounds.json. All of
 * it goes into the music bus of `SynthSounds`, whose gain carries the music volume and the ducking.
 */
export class MusicPlayer {
  private readonly stepSeconds: number;
  private readonly stepsPerBar: number;
  private readonly bars: { bass: string[]; lead: string[]; drums: string[]; transpose: number }[];
  private wanted = false;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private scheduled = 0;

  constructor(
    private readonly sounds: SynthSounds,
    private readonly data: MusicData,
  ) {
    this.stepSeconds = SECONDS_PER_MINUTE / data.bpm / data.stepsPerBeat;
    this.stepsPerBar = data.stepsPerBeat * BEATS_PER_BAR;
    this.bars = data.bars.map((b) => ({
      bass: AudioConfig.tokens(data.patterns.bass[b.bass] ?? ""),
      lead: AudioConfig.tokens(data.patterns.lead[b.lead] ?? ""),
      drums: AudioConfig.tokens(data.patterns.drums[b.drums] ?? ""),
      transpose: b.transpose,
    }));
    sounds.onUnlocked.add(() => this.run());
  }

  /** Plays the loop (from the first gesture on). */
  start(): void {
    this.wanted = true;
    this.run();
  }

  stop(): void {
    this.wanted = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  get wantsToPlay(): boolean {
    return this.wanted;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** Steps scheduled so far (grows while the music plays). */
  get scheduledSteps(): number {
    return this.scheduled;
  }

  get currentBar(): number {
    return this.bar;
  }

  /** Length of the whole loop in seconds. */
  get loopSeconds(): number {
    return this.stepSeconds * this.stepsPerBar * this.bars.length;
  }

  private run(): void {
    const context = this.sounds.audioContext;
    if (!this.wanted || this.timer !== null || context === null) return;
    this.nextTime = context.currentTime + START_DELAY;
    this.timer = window.setInterval(() => this.tick(), this.data.tickMs);
    this.tick();
  }

  private tick(): void {
    const context = this.sounds.audioContext;
    const bus = this.sounds.musicBus;
    if (context === null || bus === null) return;
    // After a stall (hidden tab) jump to now instead of firing every missed step at once.
    if (this.nextTime < context.currentTime) this.nextTime = context.currentTime + START_DELAY;
    while (this.nextTime < context.currentTime + this.data.lookahead) {
      this.schedule(context, bus, this.nextTime);
      this.nextTime += this.stepSeconds;
      this.step += 1;
      if (this.step >= this.stepsPerBar) {
        this.step = 0;
        this.bar = (this.bar + 1) % this.bars.length;
      }
    }
  }

  private schedule(context: AudioContext, bus: GainNode, time: number): void {
    const bar = this.bars[this.bar];
    if (bar === undefined) return;
    const { instruments, root } = this.data;
    this.note(context, bus, time, bar.bass[this.step], instruments.bass, root + bar.transpose);
    this.note(context, bus, time, bar.lead[this.step], instruments.lead, root + bar.transpose);
    const hits = bar.drums[this.step] ?? REST;
    if (hits !== REST) {
      for (const letter of hits) {
        const name = instruments.drums.kit[letter];
        if (name === undefined) continue;
        const source = new AudioBufferSourceNode(context, { buffer: this.sounds.buffer(name) });
        const gain = new GainNode(context, { gain: instruments.drums.volume });
        source.connect(gain).connect(bus);
        source.start(time);
      }
    }
    this.scheduled += 1;
  }

  private note(context: AudioContext, bus: GainNode, time: number, token: string | undefined, instrument: InstrumentData, base: number): void {
    if (token === undefined || token === REST) return;
    const midi = base + instrument.octave + Number(token);
    const frequency = A4_HZ * Math.pow(2, (midi - A4_MIDI) / SEMITONES_PER_OCTAVE);
    const length = this.stepSeconds * instrument.gate;
    const oscillator = new OscillatorNode(context, { type: instrument.wave, frequency });
    const gain = new GainNode(context, { gain: 0 });
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(instrument.volume, time + NOTE_ATTACK);
    gain.gain.exponentialRampToValueAtTime(NOTE_FLOOR, time + length);
    oscillator.connect(gain).connect(bus);
    oscillator.start(time);
    oscillator.stop(time + length + NOTE_TAIL);
  }
}
