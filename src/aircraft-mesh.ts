// ============ procedural low-poly aircraft meshes ============
// Built from a tapered multi-sided fuselage tube and tapered/swept wing panels
// (no external assets, no licensing). Body frame matches deck's SimpleMeshLayer
// orientation: +X = nose (forward), +Y = left wing, +Z = up. Units are metres;
// the layer's sizeScale inflates them to a readable marker. Two silhouettes:
// an ASK-21-style glider (long high-aspect wings, T-tail) and a Rallye-style
// light aircraft / tug (short low wings, nose prop, conventional tail).

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v: V): V => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// A fuselage cross-section. `rz` is the vertical half-height; give `rzTop`/`rzBot`
// instead to make it egg-shaped (a taller top than bottom) — used to raise the
// canopy over the cockpit without dropping the belly. `cz` shifts the ring centre.
interface Station { x: number; ry: number; rz?: number; rzTop?: number; rzBot?: number; cz?: number; }
interface Edge { le: number; te: number; y: number; z: number; } // wing cross-section

class MeshBuilder {
  private V: V[] = [];
  private I: number[] = [];

  private add(p: V): number { this.V.push(p); return this.V.length - 1; }
  private tri(a: number, b: number, c: number): void { this.I.push(a, b, c); }
  private quad(a: number, b: number, c: number, d: number): void { this.tri(a, b, c); this.tri(a, c, d); }
  // Winding-aware quad: flipped reverses the outward normal (for mirrored panels).
  private quadF(flip: boolean, a: number, b: number, c: number, d: number): void {
    if (flip) this.quad(a, d, c, b); else this.quad(a, b, c, d);
  }

  private ring(s: Station, sides: number): number[] {
    const idx: number[] = [];
    const cz = s.cz ?? 0, rTop = s.rzTop ?? s.rz ?? 0, rBot = s.rzBot ?? s.rz ?? 0;
    for (let i = 0; i < sides; i++) {
      const a = 2 * Math.PI * i / sides, sa = Math.sin(a);
      idx.push(this.add([s.x, s.ry * Math.cos(a), cz + (sa >= 0 ? rTop : rBot) * sa]));
    }
    return idx;
  }

  // Tapered tube fuselage through ordered stations (nose→tail, decreasing x),
  // closed with pointed nose/tail cones.
  tube(stations: Station[], sides: number, noseTip: V, tailTip: V): this {
    const rings = stations.map(s => this.ring(s, sides));
    for (let j = 0; j < rings.length - 1; j++) {
      const A = rings[j], B = rings[j + 1];
      for (let i = 0; i < sides; i++) { const i1 = (i + 1) % sides; this.quad(A[i], B[i], B[i1], A[i1]); }
    }
    const nt = this.add(noseTip), A0 = rings[0];
    for (let i = 0; i < sides; i++) { const i1 = (i + 1) % sides; this.tri(A0[i], A0[i1], nt); }
    const tt = this.add(tailTip), BN = rings[rings.length - 1];
    for (let i = 0; i < sides; i++) { const i1 = (i + 1) % sides; this.tri(BN[i1], BN[i], tt); }
    return this;
  }

  // Tapered wing/stabiliser panel (thickness th) from root edge r to tip edge t.
  panel(r: Edge, t: Edge, th: number): this {
    const flip = t.y < r.y; // left side: reverse winding to keep normals outward
    const v = (x: number, y: number, z: number) => this.add([x, y, z]);
    const rLt = v(r.le, r.y, r.z + th), rTt = v(r.te, r.y, r.z + th), rTb = v(r.te, r.y, r.z - th), rLb = v(r.le, r.y, r.z - th);
    const tLt = v(t.le, t.y, t.z + th), tTt = v(t.te, t.y, t.z + th), tTb = v(t.te, t.y, t.z - th), tLb = v(t.le, t.y, t.z - th);
    this.quadF(flip, rLt, tLt, tTt, rTt); // top
    this.quadF(flip, rLb, rTb, tTb, tLb); // bottom
    this.quadF(flip, rLb, tLb, tLt, rLt); // leading edge
    this.quadF(flip, rTt, tTt, tTb, rTb); // trailing edge
    this.quadF(flip, tLt, tLb, tTb, tTt); // tip cap
    return this;
  }

  // Vertical fin (extruded along Z, thickness th in Y).
  fin(rootLe: number, rootTe: number, rootZ: number, tipLe: number, tipTe: number, tipZ: number, th: number): this {
    const v = (x: number, y: number, z: number) => this.add([x, y, z]);
    const rLr = v(rootLe, th, rootZ), rTr = v(rootTe, th, rootZ), rTl = v(rootTe, -th, rootZ), rLl = v(rootLe, -th, rootZ);
    const tLr = v(tipLe, th, tipZ), tTr = v(tipTe, th, tipZ), tTl = v(tipTe, -th, tipZ), tLl = v(tipLe, -th, tipZ);
    this.quad(rLr, rTr, tTr, tLr); // +Y side
    this.quad(rLl, tLl, tTl, rTl); // -Y side
    this.quad(rLl, rLr, tLr, tLl); // leading edge
    this.quad(rTr, rTl, tTl, tTr); // trailing edge
    this.quad(tLr, tTr, tTl, tLl); // tip cap
    return this;
  }

  // Thin double-sided disc in the Y-Z plane (propeller).
  disc(x: number, r: number, sides: number): this {
    const cF = this.add([x + 0.01, 0, 0]), cB = this.add([x - 0.01, 0, 0]);
    const ring = this.ring({ x, ry: r, rz: r }, sides);
    for (let i = 0; i < sides; i++) {
      const i1 = (i + 1) % sides;
      this.tri(cF, ring[i], ring[i1]);   // front
      this.tri(cB, ring[i1], ring[i]);   // back
    }
    return this;
  }

  // `blades` flat tapered propeller blades in the Y-Z plane at x, radiating from
  // the spin (X) axis (root radius r0 → tip r1; half-width hw → hwt; thickness th).
  prop(x: number, r0: number, r1: number, hw: number, hwt: number, th: number, blades: number): this {
    for (let b = 0; b < blades; b++) {
      const a = b / blades * 2 * Math.PI, uy = Math.cos(a), uz = Math.sin(a), ty = -Math.sin(a), tz = Math.cos(a);
      for (const s of [th, -th]) {                                   // front + back face
        const A = this.add([x + s, r0 * uy - hw * ty, r0 * uz - hw * tz]), B = this.add([x + s, r0 * uy + hw * ty, r0 * uz + hw * tz]);
        const C = this.add([x + s, r1 * uy + hwt * ty, r1 * uz + hwt * tz]), D = this.add([x + s, r1 * uy - hwt * ty, r1 * uz - hwt * tz]);
        if (s > 0) this.quad(A, B, C, D); else this.quad(A, D, C, B);
      }
    }
    return this;
  }

  geometry() {
    const P: number[] = [], N: number[] = [];
    // Flat per-face normals: duplicate vertices so each triangle is independent.
    const flat: V[] = [], idx: number[] = [];
    for (let f = 0; f < this.I.length; f += 3) {
      const a = this.V[this.I[f]], b = this.V[this.I[f + 1]], c = this.V[this.I[f + 2]];
      const n = norm(cross(sub(b, a), sub(c, a)));
      for (const p of [a, b, c]) { idx.push(flat.length); flat.push(p); P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); }
    }
    return {
      attributes: { POSITION: { value: new Float32Array(P), size: 3 }, NORMAL: { value: new Float32Array(N), size: 3 } },
      indices: { value: new Uint32Array(idx), size: 1 }, mode: 4,
    };
  }
}

function buildGlider() {
  const m = new MeshBuilder();
  // Short blunt rounded nose → a canopy that rises just behind it (rzTop ≫ rzBot)
  // → a long slim tail boom. Only the tail tapers; the nose stays stubby. Reads
  // as a glider, not a rocket.
  m.tube([
    { x: 2.8, ry: 0.19, rzTop: 0.27, rzBot: 0.22 },   // stubby nose (short cap ahead)
    { x: 2.4, ry: 0.24, rzTop: 0.36, rzBot: 0.27, cz: 0.02 },   // windscreen base
    { x: 2.0, ry: 0.26, rzTop: 0.43, rzBot: 0.28 },
    { x: 1.6, ry: 0.27, rzTop: 0.46, rzBot: 0.28 },   // canopy peak (rounded)
    { x: 1.2, ry: 0.27, rzTop: 0.44, rzBot: 0.27 },
    { x: 0.7, ry: 0.25, rzTop: 0.38, rzBot: 0.26 },   // long, gentle rear fairing
    { x: 0.1, ry: 0.22, rzTop: 0.31, rzBot: 0.25 },
    { x: -0.6, ry: 0.18, rzTop: 0.25, rzBot: 0.23 },
    { x: -1.7, ry: 0.13, rz: 0.18 },
    { x: -3.0, ry: 0.09, rz: 0.13 }, { x: -4.4, ry: 0.06, rz: 0.10 },
  ], 12, [3.05, 0, -0.03], [-4.7, 0, 0.18]);
  // long high-aspect wing (span ~17), tapered + swept + dihedral
  const wr: Edge = { le: 0.6, te: -0.55, y: 0.3, z: 0.06 };
  m.panel(wr, { le: 0.2, te: -0.1, y: 8.6, z: 0.55 }, 0.05);
  m.panel(wr, { le: 0.2, te: -0.1, y: -8.6, z: 0.55 }, 0.05);
  // T-tail — fin root at the fuselage centreline (z 0) so its base meets the
  // tapering rear fuselage (top ~0.04–0.12 there); it emerges through the top.
  m.fin(-3.7, -4.5, 0.0, -3.95, -4.5, 1.7, 0.05);
  const tr: Edge = { le: -3.85, te: -4.45, y: 0, z: 1.72 };
  m.panel(tr, { le: -4.0, te: -4.45, y: 1.7, z: 1.72 }, 0.04);
  m.panel(tr, { le: -4.0, te: -4.45, y: -1.7, z: 1.72 }, 0.04);
  return m.geometry();
}

function buildPlane() {
  const m = new MeshBuilder();
  // Morane-Saulnier Rallye silhouette: blunt rounded engine cowl (short cap, prop
  // at the tip) → a tall, roomy "greenhouse" canopy (rzTop ≫ rzBot) → tapered rear
  // fuselage. Not a pointed rocket nose.
  m.tube([
    { x: 2.55, ry: 0.21, rzTop: 0.25, rzBot: 0.24 },   // blunt cowl front (spinner base)
    { x: 2.1, ry: 0.30, rzTop: 0.36, rzBot: 0.34 },    // engine cowl
    { x: 1.5, ry: 0.37, rzTop: 0.44, rzBot: 0.42 },    // firewall (widest)
    { x: 0.9, ry: 0.37, rzTop: 0.56, rzBot: 0.40, cz: 0.02 },   // windscreen base
    { x: 0.2, ry: 0.35, rzTop: 0.58, rzBot: 0.40 },    // greenhouse canopy peak
    { x: -0.6, ry: 0.30, rzTop: 0.47, rzBot: 0.34 },   // canopy trailing
    { x: -1.5, ry: 0.21, rzTop: 0.30, rzBot: 0.28 },   // turtledeck
    { x: -2.7, ry: 0.12, rz: 0.18 }, { x: -3.4, ry: 0.07, rz: 0.11 },
  ], 12, [2.9, 0, 0.0], [-3.6, 0, 0.2]);
  // short low wing (span ~10)
  const wr: Edge = { le: 0.85, te: -0.7, y: 0.36, z: -0.22 };
  m.panel(wr, { le: 0.6, te: -0.4, y: 5.0, z: -0.16 }, 0.07);
  m.panel(wr, { le: 0.6, te: -0.4, y: -5.0, z: -0.16 }, 0.07);
  // conventional tail
  m.fin(-2.6, -3.45, 0.1, -2.85, -3.45, 1.05, 0.05);
  const tr: Edge = { le: -2.8, te: -3.4, y: 0, z: 0.06 };
  m.panel(tr, { le: -3.0, te: -3.4, y: 1.9, z: 0.06 }, 0.05);
  m.panel(tr, { le: -3.0, te: -3.4, y: -1.9, z: 0.06 }, 0.05);
  return m.geometry();   // propeller is a separate (spun) mesh — see buildProp / PROP_MESH
}

// Propeller at the nose, its own (spun-by-render) mesh of radiating blades.
function buildProp() {
  return new MeshBuilder().prop(2.95, 0.12, 1.12, 0.1, 0.05, 0.02, 3).geometry();
}

export const GLIDER_MESH = buildGlider();
export const PLANE_MESH = buildPlane();
export const PROP_MESH = buildProp();

// Flattened copies (vertical extent squashed) for ground shadows: laid flat and
// oriented to the heading, they read as the aircraft's planform silhouette.
function flattenMesh(m: ReturnType<typeof buildGlider>) {
  const src = m.attributes.POSITION.value, p = new Float32Array(src);
  for (let i = 2; i < p.length; i += 3) p[i] *= 0.05;
  return { ...m, attributes: { ...m.attributes, POSITION: { value: p, size: 3 } } };
}
export const GLIDER_FLAT = flattenMesh(GLIDER_MESH);
export const PLANE_FLAT = flattenMesh(PLANE_MESH);

// OGN aircraft_type codes treated as powered (everything else → glider mesh).
const POWERED = new Set([2, 5, 8, 9]); // tow plane, drop plane, piston, jet
export const isPowered = (type: number | undefined): boolean => POWERED.has(type ?? 0);
