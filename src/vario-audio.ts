// ============ audio variometer ============
// Turns the followed glider's vario into sound: chopped rising beeps in lift
// (cadence grows with the climb rate), a continuous low tone in sink, and
// silence within a deadband around zero — like an electronic glider vario.
// Ported from the standalone "vario sonore" demo; Vz is mapped over ±5 m/s.

const F0 = 600;          // reference frequency at Vz = 0 (Hz)
const DEADBAND = 0.15;   // |Vz| below this is silent (m/s)
const VOL = 0.32;        // master gain
const LOOK = 25;         // scheduler tick (ms)
const AHEAD = 0.13;      // beep scheduling horizon (s)

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// Sound law for a given vertical speed (Vz, m/s).
function params(vz: number) {
  const mode = vz > DEADBAND ? 'climb' : vz < -DEADBAND ? 'sink' : 'silent';
  const freq = clamp(F0 * Math.pow(2, (vz / 5) * 1.32), 170, 1750);
  const rate = clamp(1.2 + 1.8 * Math.abs(vz), 1.2, 11);   // beeps/s
  const period = 1 / rate;
  const duty = clamp(0.34 + 0.16 * (Math.abs(vz) / 5), 0.30, 0.55);
  return { mode, freq, period, duty };
}

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
    const p = params(this.vz);
    osc.frequency.setTargetAtTime(p.freq, ctx.currentTime, 0.02);
    if (p.mode === 'climb') {
      while (this.nextBeep < ctx.currentTime + AHEAD) { this.beep(this.nextBeep, p); this.nextBeep += p.period; }
    } else if (p.mode === 'sink') {
      this.continuous(1); this.nextBeep = ctx.currentTime;
    } else {
      this.continuous(0); this.nextBeep = ctx.currentTime;
    }
  }

  private beep(t: number, p: { period: number; duty: number }): void {
    const g = this.gate!.gain, on = Math.max(0.03, p.duty * p.period), atk = 0.006, rel = 0.012;
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + atk);
    g.setValueAtTime(1, Math.max(t + atk, t + on - rel)); g.linearRampToValueAtTime(0, t + on);
  }

  private continuous(level: number): void {
    const g = this.gate!.gain, t = this.ctx!.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(level, t, 0.012);
  }
}

export const varioAudio = new VarioAudio();
