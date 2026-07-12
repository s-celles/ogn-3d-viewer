// ============ the atmosphere: sounding, wind profile, convection ============
// The soaring meteorology of a day, as plain data and plain functions: a wind
// profile by altitude, a temperature sounding, the cloudbase (LCL), the thermal
// ceiling and the static stability N. Nothing here fetches or caches anything —
// the caller brings the data (a downloaded snapshot, a file read offline, or a
// synthetic sandbox atmosphere) and this turns it into the quantities the lift
// models and the day-structure panel need.
//
// Offline by construction: `Wx` is a value. Whoever produced it — network today,
// a pre-flight data pack tomorrow — is not this module's business.

/** A wind sample of the profile: AMSL height + velocity vector (m/s, east/north). */
export interface Prof { alt: number; u: number; v: number }
/** A sounding sample: AMSL height + air temperature (°C). */
export interface TPt { alt: number; T: number }
/** One hour of the day: cloudbase, wind profile, radiation, boundary layer, sounding. */
export interface WxHour {
  cloudbase: number | null;   // AMSL (m), from the LCL
  prof: Prof[];               // wind profile, ascending in altitude
  sw: number;                 // shortwave radiation (W/m²)
  diff: number;               // diffuse radiation (W/m²)
  blh: number;                // boundary-layer height (m above the surface)
  t2m: number;                // surface air temperature (°C)
  tprof: TPt[];               // temperature sounding, ascending in altitude
}
/** A day's weather at one location. `ref` = the surface elevation it is relative to. */
export interface Wx { hours: WxHour[]; ref: number }

/** The knobs of a synthetic ("what-if") atmosphere. */
export interface WxKnobs {
  wind: number;    // surface wind speed (m/s)
  dir: number;     // direction it blows FROM (°)
  shear: number;   // wind increase with height (m/s per km)
  nStab: number;   // target Brunt–Väisälä frequency N (1/s)
  tsurf: number;   // surface temperature (°C)
  rh: number;      // surface relative humidity (%)
}

export const LEVELS = [925, 850, 700];   // hPa: through the convective layer
export const DRY = 0.0098;               // dry-adiabatic lapse rate (K/m)
export const TRIGGER_EXCESS = 1.5;       // K: thermal parcel excess over ambient (superadiabatic surface layer)
const G = 9.81;

/** Met wind (speed, direction it blows FROM in °) → velocity vector it blows TO (east, north). */
export function windToUV(sp: number, dir: number): Prof {
  const r = dir * Math.PI / 180;
  return { alt: 0, u: -sp * Math.sin(r), v: -sp * Math.cos(r) };
}

/** Dew point (°C) from temperature (°C) and relative humidity (%) — Magnus formula. */
export function dewpoint(T: number, RH: number): number {
  const a = 17.625, b = 243.04, g = Math.log(Math.max(1, Math.min(100, RH)) / 100) + a * T / (b + T);
  return b * g / (a - g);
}

/** Cloudbase AMSL (m) from the lifting condensation level: ~125 m per °C of spread
 *  above a surface at `elev`. Null when T or RH is unavailable. */
export function lclBase(T: number, RH: number, elev: number): number | null {
  if (!Number.isFinite(T) || !Number.isFinite(RH)) return null;
  return elev + Math.max(50, 125 * (T - dewpoint(T, RH)));
}

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);

/** Build the day's `Wx` from an Open-Meteo hourly payload (forecast or archive — same
 *  shape). `fallbackElev` is used when the model does not report its surface elevation.
 *  Returns null when the payload carries no usable hours. Pure: the caller does the I/O. */
export function parseOpenMeteo(json: unknown, fallbackElev: number): Wx | null {
  const j = json as any;
  const h = j && j.hourly;
  if (!h || !Array.isArray(h.time) || !h.time.length) return null;
  const elev = num(j.elevation);
  const ref = Number.isFinite(elev) ? elev : fallbackElev;
  const hours: WxHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const prof: Prof[] = [];
    const s10 = num(h.wind_speed_10m?.[i]), d10 = num(h.wind_direction_10m?.[i]);
    if (Number.isFinite(s10) && Number.isFinite(d10)) prof.push({ ...windToUV(s10, d10), alt: ref + 10 });
    for (const p of LEVELS) {
      const hh = num(h[`geopotential_height_${p}hPa`]?.[i]);
      const sp = num(h[`wind_speed_${p}hPa`]?.[i]), dr = num(h[`wind_direction_${p}hPa`]?.[i]);
      if (Number.isFinite(hh) && Number.isFinite(sp) && Number.isFinite(dr)) prof.push({ ...windToUV(sp, dr), alt: hh });
    }
    prof.sort((a, b) => a.alt - b.alt);
    // Temperature sounding: surface + pressure levels, for the thermal ceiling.
    const t2m = num(h.temperature_2m?.[i]);
    const tprof: TPt[] = Number.isFinite(t2m) ? [{ alt: ref, T: t2m }] : [];
    for (const p of LEVELS) {
      const hh = num(h[`geopotential_height_${p}hPa`]?.[i]), tp = num(h[`temperature_${p}hPa`]?.[i]);
      if (Number.isFinite(hh) && Number.isFinite(tp) && hh > ref) tprof.push({ alt: hh, T: tp });
    }
    tprof.sort((a, b) => a.alt - b.alt);
    hours.push({
      cloudbase: lclBase(t2m, num(h.relative_humidity_2m?.[i]), ref), prof, t2m, tprof,
      sw: num(h.shortwave_radiation?.[i]), diff: num(h.diffuse_radiation?.[i]), blh: num(h.boundary_layer_height?.[i]),
    });
  }
  return { hours, ref: Number.isFinite(ref) ? ref : 0 };
}

/** A synthetic atmosphere from a few knobs: a uniform wind growing with height by the
 *  shear, and a layer whose environmental lapse gives the target stability N. Every
 *  model reads it through the same accessors, so the whole chain (slope lift, thermals,
 *  wave, day structure) reacts — "what-if" flying, on the ground, with no network. */
export function syntheticWx(k: WxKnobs, ref: number): Wx {
  const Tk = k.tsurf + 273.15;
  const lapse = Math.max(0.0005, DRY - k.nStab * k.nStab * Tk / G);   // env lapse (K/m); < DRY ⇒ stable
  const prof: Prof[] = [ref + 10, ref + 800, ref + 1500, ref + 3000].map(alt => {
    const p = windToUV(Math.max(0, k.wind + k.shear * (alt - ref) / 1000), k.dir); return { ...p, alt };
  });
  const tprof: TPt[] = [ref, ref + 1500, ref + 3000].map(alt => ({ alt, T: k.tsurf - lapse * (alt - ref) }));
  const hour: WxHour = { cloudbase: lclBase(k.tsurf, k.rh, ref), prof, sw: NaN, diff: NaN, blh: 1200, t2m: k.tsurf, tprof };
  return { hours: Array.from({ length: 24 }, () => hour), ref };
}

const clampHour = (wx: Wx, hour: number): number => Math.max(0, Math.min(wx.hours.length - 1, hour | 0));

/** Cloudbase AMSL (m) at a UTC hour, or null if unavailable. */
export function weatherCloudbase(wx: Wx, hour: number): number | null {
  return wx.hours[clampHour(wx, hour)]?.cloudbase ?? null;
}

/** Shortwave/diffuse radiation (W/m²) and boundary-layer height (m) at a UTC hour. */
export function weatherRad(wx: Wx, hour: number): { sw: number; diff: number; blh: number } {
  const h = wx.hours[clampHour(wx, hour)];
  return { sw: h?.sw ?? NaN, diff: h?.diff ?? NaN, blh: h?.blh ?? NaN };
}

/** Thermal ceiling AMSL (m) at a UTC hour: the altitude where a surface parcel
 *  (ambient + a small excess, rising dry-adiabatically) meets the environmental
 *  sounding — i.e. the top of dry convection. Falls back to the boundary-layer height
 *  above the model surface when the sounding is unavailable; NaN if neither is. */
export function weatherConvTop(wx: Wx, hour: number): number {
  const h = wx.hours[clampHour(wx, hour)]; if (!h) return NaN;
  const tp = h.tprof;
  if (tp && tp.length >= 2 && Number.isFinite(h.t2m)) {
    const ref = tp[0].alt, T0 = tp[0].T + TRIGGER_EXCESS;
    let top = ref;
    for (let i = 1; i < tp.length; i++) {
      const a = tp[i - 1], b = tp[i];
      const pb = T0 - DRY * (b.alt - ref);                 // parcel temp at b
      if (pb >= b.T) { top = b.alt; continue; }            // still buoyant → ceiling at least b
      const fa = (T0 - DRY * (a.alt - ref)) - a.T, fb = pb - b.T;   // parcel − env at a, b
      top = fa > 0 ? a.alt + (fa / (fa - fb)) * (b.alt - a.alt) : a.alt;
      break;
    }
    if (top > ref + 50) return top;   // a real convective depth from the sounding
  }
  return Number.isFinite(h.blh) && h.blh > 0 ? wx.ref + h.blh : NaN;   // fallback: BL top above model surface
}

/** The day's structure at a UTC hour: surface elevation and temperature, the
 *  temperature sounding, the cloudbase (LCL) and the thermal ceiling. Null when the
 *  sounding is unavailable. */
export interface Sounding { ref: number; t2m: number; tprof: TPt[]; cloudbase: number | null; ceiling: number }
export function weatherSounding(wx: Wx, hour: number): Sounding | null {
  const h = wx.hours[clampHour(wx, hour)];
  if (!h || !h.tprof || h.tprof.length < 2 || !Number.isFinite(h.t2m)) return null;
  return { ref: wx.ref, t2m: h.t2m, tprof: h.tprof, cloudbase: h.cloudbase, ceiling: weatherConvTop(wx, hour) };
}

/** Static stability as the Brunt–Väisälä frequency N (1/s) in the layer above the
 *  ridges (the upper sounding levels), for the lee-wave model. NaN when the layer is
 *  neutral/unstable (no wave) or the sounding is unavailable. */
export function weatherStability(wx: Wx, hour: number): number {
  const tp = wx.hours[clampHour(wx, hour)]?.tprof;
  if (!tp || tp.length < 2) return NaN;
  const a = tp[tp.length - 2], b = tp[tp.length - 1], dz = b.alt - a.alt;   // top layer (above the ridges)
  if (dz < 100) return NaN;
  const dThetaDz = (b.T - a.T) / dz + DRY;         // potential-temp gradient (K/m)
  if (dThetaDz <= 0) return NaN;                    // neutral / unstable → no wave
  return Math.sqrt(G / ((a.T + b.T) / 2 + 273.15) * dThetaDz);
}

/** Wind vector [east, north] (m/s) at an AMSL altitude and UTC hour, or null. */
export function weatherWind(wx: Wx, hour: number, alt: number): [number, number] | null {
  const p = wx.hours[clampHour(wx, hour)]?.prof;
  if (!p || !p.length) return null;
  if (alt <= p[0].alt) return [p[0].u, p[0].v];
  for (let i = 1; i < p.length; i++) {
    if (alt <= p[i].alt) { const a = p[i - 1], b = p[i], f = (alt - a.alt) / Math.max(1, b.alt - a.alt); return [a.u + (b.u - a.u) * f, a.v + (b.v - a.v) * f]; }
  }
  const e = p[p.length - 1]; return [e.u, e.v];
}

/** Environmental temperature (°C) at an AMSL altitude, interpolated from the sounding
 *  (clamped to its ends — we never extrapolate the atmosphere). */
export function envT(s: Sounding, alt: number): number {
  const p = s.tprof;
  if (alt <= p[0].alt) return p[0].T;
  for (let i = 1; i < p.length; i++) if (alt <= p[i].alt) {
    const a = p[i - 1], b = p[i]; return a.T + (b.T - a.T) * (alt - a.alt) / Math.max(1, b.alt - a.alt);
  }
  return p[p.length - 1].T;
}

/** Temperature (°C) of the rising surface parcel at an AMSL altitude: it leaves the
 *  ground with a small excess and cools along the dry adiabat. */
export function parcelT(s: Sounding, alt: number): number {
  return s.t2m + TRIGGER_EXCESS - DRY * (alt - s.ref);
}

/** The day in one line: how deep the convection goes, whether it is a cumulus or a blue
 *  day, and whether the parcel is still buoyant at the top of the sounding (so the
 *  ceiling is a lower bound, not a measurement). */
export function daySummary(s: Sounding): { depth: number; isCu: boolean; openTop: boolean } {
  const depth = Math.max(0, Math.round(s.ceiling - s.ref));
  const isCu = s.cloudbase != null && s.ceiling >= s.cloudbase + 80;
  const openTop = s.ceiling >= s.tprof[s.tprof.length - 1].alt - 1;
  return { depth, isCu, openTop };
}
