// ============ lee waves (mountain wave / onde): resonant lift downwind of ridges ======
// When a stable airstream crosses a ridge with enough wind, it oscillates downwind as a
// standing wave: smooth lift in the crests, sink in the troughs, at the wavelength
//   λ = 2π·U / N                (U = cross-ridge wind, N = Brunt–Väisälä frequency)
// We take the terrain forcing along the wind (w₀ = wind·∇terrain) and convolve the UPWIND
// profile with a decaying sinusoid at the resonant wavenumber l = N/U — a linear,
// illustrative lee-wave response. It yields, per node, the vertical velocity w (sin) and
// the streamline displacement η (cos, a quarter-wave out of phase).
//
// The wave is an ELEVATED phenomenon: nothing here is draped on the ground, and nothing
// here draws. Rough (see the docs), but a value.
import { sampleNodes, type NodeGrid } from './grid';
import type { ElevSampler } from '../ports';

export const GB = 140;          // terrain-gradient baseline (m)
export const WIND_MIN = 7;      // m/s: weakest cross-ridge wind that makes wave (~25 km/h)
export const N_MIN = 0.006;     // 1/s: weakest stability that makes wave
export const LAMBDA_MIN = 2000, LAMBDA_MAX = 35000;   // m: plausible lee-wave wavelengths
export const AMP = 1.6;         // display gain on the vertical-velocity (w) response
export const ETA_GAIN = 320;    // gain on the streamline vertical displacement η (m)
export const ETA_MAX = 260;     // m: clamp η so sheets never cross
// Rotor: a turbulent low-level roll beneath the wave crests (the hazard under the smooth wave).
export const ROTOR_W = 0.9;     // m/s: crest updraft strong enough to spin a rotor beneath it
export const ROTOR_THIN = 5, ROTOR_MAX = 48;   // thinning bucket + cap for rotor puffs

/** The resonant response of a stable airstream to a ridge: the Scorer wavenumber l = N/U
 *  and the wavelength λ = 2π/l it sets. */
export interface Resonance { l: number; lambda: number }

/** Is there a lee wave at all, and at what wavelength? Null when the wind is too weak to
 *  force one, the air too neutral to oscillate, or the resulting wavelength implausible.
 *  Cheap enough to ask before touching the terrain. */
export function waveResonance(wind: readonly [number, number], N: number): Resonance | null {
  const spd = Math.hypot(wind[0], wind[1]);
  if (spd < WIND_MIN) return null;          // too little wind → no wave
  if (!(N > N_MIN)) return null;            // neutral / unstable → nothing to oscillate
  const l = N / spd, lambda = 2 * Math.PI / l;
  if (lambda < LAMBDA_MIN || lambda > LAMBDA_MAX) return null;
  return { l, lambda };
}

export interface WaveParams {
  res: Resonance;
  gb?: number; amp?: number; etaGain?: number; etaMax?: number;
}

/** The wave, per node of the lattice (indexed j * n + i): the vertical velocity `w` (m/s)
 *  and the streamline displacement `eta` (m). `h` and `maxTerr` come along because the
 *  sheets are stacked above the highest ridge and the rotor sits just above the ground. */
export interface WaveField {
  grid: NodeGrid; res: Resonance;
  lon: Float64Array; lat: Float64Array;                     // node coordinates, by i and by j
  w: Float32Array; eta: Float32Array; h: Float32Array; ok: Uint8Array;
  maxTerr: number; ready: number; total: number;
}

export function waveField(
  g: NodeGrid, elev: ElevSampler, wind: readonly [number, number], p: WaveParams,
): WaveField {
  const gb = p.gb ?? GB, amp = p.amp ?? AMP;
  const etaGain = p.etaGain ?? ETA_GAIN, etaMax = p.etaMax ?? ETA_MAX;
  const { l, lambda } = p.res;
  const n = g.n, total = n * n;
  const spd = Math.hypot(wind[0], wind[1]);

  // Pass 1: terrain forcing along the wind, w₀ = wind·∇terrain (m/s), per node; and the
  // highest ridge, so the elevated sheets can sit above the terrain.
  const t = sampleNodes(g, elev, gb);
  const { ok, h, gx, gy, sp, lon, lat } = t;
  const F = new Float32Array(total);
  let maxTerr = -Infinity;
  for (let idx = 0; idx < total; idx++) {
    if (!ok[idx]) continue;
    F[idx] = wind[0] * gx[idx] + wind[1] * gy[idx];
    if (h[idx] > maxTerr) maxTerr = h[idx];
  }

  // Pass 2: convolve the UPWIND forcing with a decaying resonant kernel — the vertical
  // velocity w (sin) for the colour, and the displacement η (cos, a quarter-wave out of
  // phase) for the ripple. Looking only upwind is what makes the wave a *lee* phenomenon.
  const uE = -wind[0] / spd, uN = -wind[1] / spd;                    // upwind unit vector
  const Ld = 2.5 * lambda, Lmax = Math.min(3 * lambda, g.R * 1.7), stepM = lambda / 9;
  const w = new Float32Array(total), eta = new Float32Array(total);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const idx = j * n + i; if (!ok[idx]) continue;
    let ws = 0, we = 0;
    for (let s = stepM; s <= Lmax; s += stepM) {
      const si = Math.round(i + uE * s / sp), sj = Math.round(j + uN * s / sp);
      if (si < 0 || si >= n || sj < 0 || sj >= n) break;
      const fi = sj * n + si; if (!ok[fi]) continue;
      const dec = Math.exp(-s / Ld);
      ws += F[fi] * Math.sin(l * s) * dec; we += F[fi] * Math.cos(l * s) * dec;
    }
    w[idx] = ws * amp * stepM / lambda;
    eta[idx] = Math.max(-etaMax, Math.min(etaMax, we * etaGain * stepM / lambda));
  }
  return { grid: g, res: p.res, lon, lat, w, eta, h, ok, maxTerr, ready: t.ready, total };
}

/** Where a rotor rolls: a spot under a crest whose updraft is strong enough to spin one,
 *  thinned to one per bucket and capped, with a size that grows with the crest. Positions
 *  and sizes only — what to draw there is the renderer's business. */
export interface RotorSpot { lon: number; lat: number; elev: number; size: number }

export function rotorSpots(f: WaveField, thin = ROTOR_THIN, max = ROTOR_MAX): RotorSpot[] {
  const { n } = f.grid;
  const out: RotorSpot[] = [], occ = new Set<string>();
  for (let j = 0; j < n && out.length < max; j++) for (let i = 0; i < n; i++) {
    const idx = j * n + i;
    if (!f.ok[idx] || f.w[idx] < ROTOR_W) continue;
    const bk = `${(i / thin) | 0},${(j / thin) | 0}`;
    if (occ.has(bk)) continue;
    occ.add(bk);
    out.push({
      lon: f.lon[i], lat: f.lat[j], elev: f.h[idx],
      size: 320 + Math.min(1, (f.w[idx] - ROTOR_W) / 1.5) * 380,
    });
  }
  return out;
}
