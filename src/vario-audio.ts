// ============ audio variometer ============
// Turns the followed glider's vario into sound: chopped rising beeps in lift
// (cadence grows with the climb rate), a continuous low tone in sink, and
// silence within a deadband around zero — like an electronic glider vario.
//
// The sound LAW no longer lives here. It is soaring domain, not app code, and a
// sibling app (VOLPLANE) needed exactly the same thing — which is the only proof
// of genericity worth having. So it moved to `soaring-core/varioaudio` (v0.3.0),
// where it is a pure function from a vertical speed to a tone, and where a test
// suite guards it. VOLPLANE had first grown its own, and it sounded wrong: a
// linear pitch ramp, a sine wave, a sink deadband so wide that gentle sink was
// mute. One law, one dialect, both apps.
//
// What stays here is what an app should own: the audio graph, the square wave
// (a sine is a doorbell), and the beep scheduler that writes envelopes onto the
// audio clock ahead of time — a gain toggled from a timer clicks.

import { varioTone, F0, type Tone } from 'soaring-core/varioaudio';

const VOL = 0.32;        // master gain
const LOOK = 25;         // scheduler tick (ms)
const AHEAD = 0.13;      // beep scheduling horizon (s)

class VarioAudio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gate: GainNode | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeep = 0;
  private vz = 0;
  private active = false;

  // Build the audio graph. Browsers create it suspended until a user gesture.
  private ensure(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    const ctx: AudioContext = new Ctor();
    const osc = ctx.createOscillator(), gate = ctx.createGain(), master = ctx.createGain();
    osc.type = 'square'; osc.frequency.value = F0; gate.gain.value = 0; master.gain.value = VOL;
    osc.connect(gate).connect(master).connect(ctx.destination); osc.start();
    this.ctx = ctx; this.osc = osc; this.gate = gate; this.master = master;
    this.nextBeep = ctx.currentTime;
    this.timer = setInterval(() => this.tick(), LOOK);
  }

  // Call from a user gesture to unlock / resume audio.
  resume(): void { this.ensure(); this.ctx?.resume(); }

  // Whether the context is actually producing sound (false until a gesture
  // unlocks it — mobile autoplay policies start it suspended).
  get running(): boolean { return this.ctx?.state === 'running'; }

  // Per-frame feed: the current Vz and whether sound should play. Does NOT create
  // the AudioContext (that must happen inside a user gesture, via resume()).
  update(vz: number, active: boolean): void { this.vz = vz; this.active = active; }

  private tick(): void {
    const ctx = this.ctx, gate = this.gate, osc = this.osc;
    if (!ctx || !gate || !osc) return;
    if (!this.active) { this.continuous(0); this.nextBeep = ctx.currentTime; return; }
    // The kernel decides WHAT to sound; everything below merely makes the noise.
    // pulsesPerS === 0 means a continuous tone (the sink growl), which is NOT the
    // same thing as silence.
    const t: Tone = varioTone(this.vz);
    if (t.silent) { this.continuous(0); this.nextBeep = ctx.currentTime; return; }
    osc.frequency.setTargetAtTime(t.hz, ctx.currentTime, 0.02);
    if (t.pulsesPerS <= 0) { this.continuous(1); this.nextBeep = ctx.currentTime; return; }
    const period = 1 / t.pulsesPerS;
    if (this.nextBeep < ctx.currentTime) this.nextBeep = ctx.currentTime;
    while (this.nextBeep < ctx.currentTime + AHEAD) {
      this.beep(this.nextBeep, period, t.duty);
      this.nextBeep += period;
    }
  }

  private beep(t: number, period: number, duty: number): void {
    const g = this.gate!.gain, on = Math.max(0.03, duty * period), atk = 0.006, rel = 0.012;
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + atk);
    g.setValueAtTime(1, Math.max(t + atk, t + on - rel)); g.linearRampToValueAtTime(0, t + on);
  }

  private continuous(level: number): void {
    const g = this.gate!.gain, t = this.ctx!.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(level, t, 0.012);
  }
}

export const varioAudio = new VarioAudio();
