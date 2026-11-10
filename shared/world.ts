// Deterministic world: terrain heightfield, points of interest, structures,
// harvestable nodes and collision data. Identical on client and server.
import { fbm, hash2, lerp, mulberry32, smoothstep, clamp } from './rng';
import type { ItemId } from './items';

export const WORLD_HALF = 320;
export const GRID_N = 321;
export const CELL = 2;
export const WATER_LEVEL = 0;
export const PLAY_RADIUS = 300;
export const DEFAULT_SEED = 1337;
export const STEP_HEIGHT = 0.65;

export type NodeKind = 'tree' | 'rock' | 'stone' | 'stick' | 'fiber' | 'berry' | 'crate';

export interface NodeDef {
  id: number;
  kind: NodeKind;
  x: number; y: number; z: number;
  rot: number;
  scale: number;
  variant: number;
  special?: ItemId;
}

export interface Box {
  x: number; y: number; z: number; // y = bottom
  sx: number; sy: number; sz: number;
  rot: number;
  mat: string;
  solid?: boolean;
  walk?: boolean;
  shape?: 'box' | 'gable';
}

export interface Prop {
  type: string;
  x: number; y: number; z: number;
  rot: number;
  scale: number;
  /** interaction id: 'radio' | 'ladder' | 'firepit' */
  use?: string;
  top?: number;
}

export interface Poi { id: string; name: string; x: number; z: number; r: number; h: number }
export interface Zone { id: string; name: string; kind: 'radiation' | 'mutant' | 'wolves'; x: number; z: number; r: number }
export interface SpawnZone { type: 'wolf' | 'deer' | 'mutant'; x: number; z: number; r: number; count: number }

export interface Collider {
  box: boolean;
  x: number; z: number;
  r: number;             // circle radius, or bounding radius for boxes
  hx: number; hz: number;
  c: number; s: number;  // cos/sin of rotation
  y0: number; y1: number;
  on: boolean;
  tag?: string;
}

export interface Platform {
  x: number; z: number; hx: number; hz: number; c: number; s: number; top: number; r: number; id?: number;
}

type Pt = [number, number];

function distSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function distPoly(px: number, pz: number, pts: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const v = distSeg(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (v < d) d = v;
  }
  return d;
}

/** Rotation convention matches THREE's rotation.y */
export function toWorld(lx: number, lz: number, c: number, s: number): Pt {
  return [lx * c + lz * s, -lx * s + lz * c];
}
export function toLocal(dx: number, dz: number, c: number, s: number): Pt {
  return [dx * c - dz * s, dx * s + dz * c];
}

const GRID_CELL = 8;
const gkey = (cx: number, cz: number) => (cx + 512) * 4096 + (cz + 512);

export class ColliderGrid {
  cells = new Map<number, Collider[]>();

  add(c: Collider): Collider {
    const x0 = Math.floor((c.x - c.r) / GRID_CELL), x1 = Math.floor((c.x + c.r) / GRID_CELL);
    const z0 = Math.floor((c.z - c.r) / GRID_CELL), z1 = Math.floor((c.z + c.r) / GRID_CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = gkey(cx, cz);
      let arr = this.cells.get(k);
      if (!arr) this.cells.set(k, (arr = []));
      arr.push(c);
    }
    return c;
  }

  remove(c: Collider) {
    c.on = false;
    const x0 = Math.floor((c.x - c.r) / GRID_CELL), x1 = Math.floor((c.x + c.r) / GRID_CELL);
    const z0 = Math.floor((c.z - c.r) / GRID_CELL), z1 = Math.floor((c.z + c.r) / GRID_CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const arr = this.cells.get(gkey(cx, cz));
      if (!arr) continue;
      const i = arr.indexOf(c);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  static circle(x: number, z: number, r: number, y0: number, y1: number, tag?: string): Collider {
    return { box: false, x, z, r, hx: 0, hz: 0, c: 1, s: 0, y0, y1, on: true, tag };
  }
  static obb(x: number, z: number, hx: number, hz: number, rot: number, y0: number, y1: number, tag?: string): Collider {
    return { box: true, x, z, r: Math.hypot(hx, hz), hx, hz, c: Math.cos(rot), s: Math.sin(rot), y0, y1, on: true, tag };
  }

  /** Push a vertical capsule (radius r, feet at y, given height) out of all solids. Mutates out. */
  resolve(out: { x: number; z: number }, r: number, y: number, height = 1.8): boolean {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      const x0 = Math.floor((out.x - r) / GRID_CELL), x1 = Math.floor((out.x + r) / GRID_CELL);
      const z0 = Math.floor((out.z - r) / GRID_CELL), z1 = Math.floor((out.z + r) / GRID_CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const arr = this.cells.get(gkey(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (!c.on || y + 0.5 >= c.y1 || y + height <= c.y0) continue;
          const dx = out.x - c.x, dz = out.z - c.z;
          if (!c.box) {
            const rr = c.r + r;
            const d2 = dx * dx + dz * dz;
            if (d2 < rr * rr) {
              const d = Math.sqrt(d2) || 0.0001;
              out.x = c.x + (dx / d) * rr;
              out.z = c.z + (dz / d) * rr;
              hit = true;
            }
          } else {
            if (dx * dx + dz * dz > (c.r + r) * (c.r + r)) continue;
            const [lx, lz] = toLocal(dx, dz, c.c, c.s);
            const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
            let nx = lx - qx, nz = lz - qz;
            const d2 = nx * nx + nz * nz;
            let px = lx, pz = lz;
            if (d2 < 1e-9) {
              // centre is inside the box: push through the nearest face
              const ex = c.hx - Math.abs(lx), ez = c.hz - Math.abs(lz);
              if (ex < ez) px = (lx < 0 ? -1 : 1) * (c.hx + r); else pz = (lz < 0 ? -1 : 1) * (c.hz + r);
            } else if (d2 < r * r) {
              const d = Math.sqrt(d2);
              nx /= d; nz /= d;
              px = qx + nx * r; pz = qz + nz * r;
            } else continue;
            const [wx, wz] = toWorld(px, pz, c.c, c.s);
            out.x = c.x + wx; out.z = c.z + wz;
            hit = true;
          }
        }
      }
    }
    return hit;
  }

  /** Is a circle overlapping any solid in the given vertical range? */
  overlaps(x: number, z: number, r: number, y0: number, y1: number, skipTag?: string): boolean {
    const cx0 = Math.floor((x - r) / GRID_CELL), cx1 = Math.floor((x + r) / GRID_CELL);
    const cz0 = Math.floor((z - r) / GRID_CELL), cz1 = Math.floor((z + r) / GRID_CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const arr = this.cells.get(gkey(cx, cz));
      if (!arr) continue;
      for (const c of arr) {
        if (!c.on || y0 >= c.y1 || y1 <= c.y0) continue;
        if (skipTag && c.tag === skipTag) continue;
        const dx = x - c.x, dz = z - c.z;
        if (!c.box) {
          if (dx * dx + dz * dz < (c.r + r) * (c.r + r)) return true;
        } else {
          const [lx, lz] = toLocal(dx, dz, c.c, c.s);
          const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
          if ((lx - qx) ** 2 + (lz - qz) ** 2 < r * r) return true;
        }
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------- layout
export const RIVER: Pt[] = [[-60, -236], [-20, -150], [40, -80], [70, -10], [50, 60], [90, 120], [112, 150]];
export const LAKE = { x: 120, z: 172, r: 44 };
export const BRIDGE = { x: 55, z: -45, rot: 0.405, len: 27, width: 4.2, top: 1.6 };
export const CAMP = { x: 0, z: 30 };
export const STATION = { x: 190, z: -150 };
export const TOWER = { x: -170, z: -40 };
export const VILLAGE = { x: -140, z: 150 };
export const CABIN = { x: 60, z: 180 };

const bridgeDir = toWorld(1, 0, Math.cos(BRIDGE.rot), Math.sin(BRIDGE.rot));
const bW: Pt = [BRIDGE.x - bridgeDir[0] * 15, BRIDGE.z - bridgeDir[1] * 15];
const bE: Pt = [BRIDGE.x + bridgeDir[0] * 15, BRIDGE.z + bridgeDir[1] * 15];

export const PATHS: Pt[][] = [
  [[CAMP.x + 4, CAMP.z - 8], [22, -14], bW, bE, [112, -84], [158, -128], [STATION.x - 14, STATION.z + 10]],
  [[CAMP.x - 8, CAMP.z - 2], [-70, 14], [-125, -8], [TOWER.x + 9, TOWER.z + 6]],
  [[CAMP.x - 6, CAMP.z + 8], [-48, 84], [-98, 124], [VILLAGE.x + 22, VILLAGE.z - 12]],
  [[CAMP.x + 6, CAMP.z + 9], [28, 110], [48, 160], [CABIN.x - 2, CABIN.z - 7]],
];

export class World {
  seed: number;
  heights = new Float32Array(GRID_N * GRID_N);
  nodes: NodeDef[] = [];
  boxes: Box[] = [];
  props: Prop[] = [];
  pois: Poi[] = [];
  zones: Zone[] = [];
  spawnZones: SpawnZone[] = [];
  colliders = new ColliderGrid();
  platforms: Platform[] = [];
  nodeColliders = new Map<number, Collider>();
  spawn = { x: CAMP.x + 3, z: CAMP.z + 5 };
  private nodeGrid = new Map<number, NodeDef[]>();

  constructor(seed = DEFAULT_SEED) {
    this.seed = seed;
    this.definePois();
    for (let j = 0; j < GRID_N; j++) for (let i = 0; i < GRID_N; i++) {
      this.heights[j * GRID_N + i] = this.genHeight(i * CELL - WORLD_HALF, j * CELL - WORLD_HALF);
    }
    this.buildStructures();
    this.scatterNodes();
    for (const n of this.nodes) {
      const k = gkey(Math.floor(n.x / GRID_CELL), Math.floor(n.z / GRID_CELL));
      let arr = this.nodeGrid.get(k);
      if (!arr) this.nodeGrid.set(k, (arr = []));
      arr.push(n);
    }
  }

  // ------------------------------------------------------------ terrain
  private carved(x: number, z: number): number {
    const s = this.seed;
    const d = Math.hypot(x, z) / WORLD_HALF;
    let h = 5.5 + (fbm(x * 0.0065, z * 0.0065, 4, s) - 0.5) * 24;
    h += (fbm(x * 0.03 + 50, z * 0.03, 3, s + 7) - 0.5) * 3.2;
    const m = smoothstep(0.6, 1.0, d);
    h += m * m * (70 + 70 * fbm(x * 0.012, z * 0.012, 4, s + 19));
    h += smoothstep(0.5, 0.75, d) * 6 * fbm(x * 0.02, z * 0.02, 2, s + 31);
    // watchtower hill
    const td = Math.hypot(x - TOWER.x, z - TOWER.z);
    h += 17 * Math.exp(-(td * td) / (2 * 38 * 38));
    // river valley and bed
    const rd = distPoly(x, z, RIVER) + (fbm(x * 0.05, z * 0.05, 2, s + 3) - 0.5) * 5;
    h = lerp(h, Math.min(h, 1.25), smoothstep(36, 12, rd));
    h = lerp(h, -2.6, smoothstep(8.5, 3, rd));
    // lake
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z) + (fbm(x * 0.03, z * 0.03, 2, s + 5) - 0.5) * 16;
    h = lerp(h, Math.min(h, 1.1), smoothstep(LAKE.r + 30, LAKE.r + 8, ld));
    h = lerp(h, -5, smoothstep(LAKE.r, LAKE.r * 0.45, ld));
    return h;
  }

  private genHeight(x: number, z: number): number {
    let h = this.carved(x, z);
    for (const p of this.pois) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r * 1.7) h = lerp(h, p.h, smoothstep(p.r * 1.7, p.r, d));
    }
    return h;
  }

  private definePois() {
    const mk = (id: string, name: string, x: number, z: number, r: number) => {
      this.pois.push({ id, name, x, z, r, h: Math.max(this.carved(x, z), 1.6) });
    };
    mk('camp', 'Лагерь выживших', CAMP.x, CAMP.z, 15);
    mk('station', 'Исследовательская станция', STATION.x, STATION.z, 27);
    mk('tower', 'Сторожевая башня', TOWER.x, TOWER.z, 9);
    mk('village', 'Заброшенный посёлок', VILLAGE.x, VILLAGE.z, 36);
    mk('cabin', 'Рыбацкая хижина', CABIN.x, CABIN.z, 9);
    this.zones.push(
      { id: 'rad', name: 'Заражённая зона', kind: 'radiation', x: VILLAGE.x, z: VILLAGE.z, r: 56 },
      { id: 'nest', name: 'Гнездо мутантов', kind: 'mutant', x: STATION.x, z: STATION.z, r: 48 },
      { id: 'wolf1', name: 'Волчья чаща', kind: 'wolves', x: -60, z: -125, r: 50 },
      { id: 'wolf2', name: 'Тёмный бор', kind: 'wolves', x: -235, z: 55, r: 48 },
    );
    this.spawnZones.push(
      { type: 'wolf', x: -60, z: -125, r: 38, count: 3 },
      { type: 'wolf', x: -235, z: 55, r: 36, count: 3 },
      { type: 'wolf', x: 30, z: 240, r: 34, count: 2 },
      { type: 'wolf', x: 150, z: 20, r: 34, count: 2 },
      { type: 'mutant', x: STATION.x, z: STATION.z, r: 30, count: 4 },
      { type: 'mutant', x: VILLAGE.x, z: VILLAGE.z, r: 34, count: 4 },
      { type: 'mutant', x: 90, z: -215, r: 26, count: 2 },
      { type: 'deer', x: -55, z: 70, r: 40, count: 3 },
      { type: 'deer', x: 110, z: -200, r: 40, count: 2 },
      { type: 'deer', x: -200, z: -150, r: 40, count: 2 },
      { type: 'deer', x: -20, z: 160, r: 40, count: 2 },
      { type: 'deer', x: 130, z: 80, r: 34, count: 2 },
    );
  }

  heightAt(x: number, z: number): number {
    const gx = clamp((x + WORLD_HALF) / CELL, 0, GRID_N - 1.0001);
    const gz = clamp((z + WORLD_HALF) / CELL, 0, GRID_N - 1.0001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const H = this.heights;
    const h00 = H[j * GRID_N + i], h10 = H[j * GRID_N + i + 1];
    const h01 = H[(j + 1) * GRID_N + i], h11 = H[(j + 1) * GRID_N + i + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Walkable ground under a body whose feet are at y (platforms above step height are ignored). */
  groundAt(x: number, z: number, y: number): number {
    let g = this.heightAt(x, z);
    const ps = this.platforms;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > p.r * p.r) continue;
      if (p.top > y + STEP_HEIGHT || p.top <= g) continue;
      const [lx, lz] = toLocal(dx, dz, p.c, p.s);
      if (Math.abs(lx) <= p.hx && Math.abs(lz) <= p.hz) g = p.top;
    }
    return g;
  }

  slopeAt(x: number, z: number): number {
    const e = 1.5;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  pathDist(x: number, z: number): number {
    let d = Infinity;
    for (const p of PATHS) d = Math.min(d, distPoly(x, z, p));
    return d;
  }
  riverDist(x: number, z: number): number { return distPoly(x, z, RIVER); }

  poiAt(x: number, z: number, pad = 0): Poi | null {
    for (const p of this.pois) if (Math.hypot(x - p.x, z - p.z) < p.r + pad) return p;
    return null;
  }
  zoneAt(x: number, z: number): Zone | null {
    for (const zn of this.zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.r) return zn;
    return null;
  }

  nodesNear(x: number, z: number, r: number, out: NodeDef[] = []): NodeDef[] {
    out.length = 0;
    const x0 = Math.floor((x - r) / GRID_CELL), x1 = Math.floor((x + r) / GRID_CELL);
    const z0 = Math.floor((z - r) / GRID_CELL), z1 = Math.floor((z + r) / GRID_CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const arr = this.nodeGrid.get(gkey(cx, cz));
      if (!arr) continue;
      for (const n of arr) if ((n.x - x) ** 2 + (n.z - z) ** 2 <= r * r) out.push(n);
    }
    return out;
  }

  addPlatform(x: number, z: number, hx: number, hz: number, rot: number, top: number, id?: number): Platform {
    const p: Platform = { x, z, hx, hz, c: Math.cos(rot), s: Math.sin(rot), top, r: Math.hypot(hx, hz) + 0.1, id };
    this.platforms.push(p);
    return p;
  }
  removePlatform(p: Platform) {
    const i = this.platforms.indexOf(p);
    if (i >= 0) this.platforms.splice(i, 1);
  }

  // ------------------------------------------------------------ structures
  private addBox(b: Box) {
    this.boxes.push(b);
    if (b.walk) this.addPlatform(b.x, b.z, b.sx / 2, b.sz / 2, b.rot, b.y + b.sy);
    if (b.solid) this.colliders.add(ColliderGrid.obb(b.x, b.z, b.sx / 2, b.sz / 2, b.rot, b.y, b.y + b.sy, 'static'));
  }

  private addProp(p: Prop, radius = 0, height = 2) {
    this.props.push(p);
    if (radius > 0) this.colliders.add(ColliderGrid.circle(p.x, p.z, radius, p.y, p.y + height, 'static'));
  }

  private addNode(kind: NodeKind, x: number, z: number, o: Partial<NodeDef> = {}): NodeDef {
    const n: NodeDef = {
      id: this.nodes.length, kind, x, z, y: o.y ?? this.heightAt(x, z),
      rot: o.rot ?? 0, scale: o.scale ?? 1, variant: o.variant ?? 0, special: o.special,
    };
    this.nodes.push(n);
    let col: Collider | null = null;
    if (kind === 'tree') col = ColliderGrid.circle(x, z, 0.42 * n.scale + (n.variant === 0 ? 0.12 : 0), n.y - 2, n.y + 9, 'node');
    else if (kind === 'rock') col = ColliderGrid.circle(x, z, 0.85 * n.scale, n.y - 2, n.y + 1.6 * n.scale, 'node');
    else if (kind === 'crate') col = ColliderGrid.circle(x, z, 0.55, n.y, n.y + 0.9, 'node');
    if (col) { this.colliders.add(col); this.nodeColliders.set(n.id, col); }
    return n;
  }

  private buildStructures() {
    const rng = mulberry32(this.seed + 99);
    const self = this;

    function site(ox: number, oz: number, rot: number, base: number) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const W = (lx: number, lz: number): Pt => { const [wx, wz] = toWorld(lx, lz, c, s); return [ox + wx, oz + wz]; };
      const api = {
        box(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, mat: string, f: Partial<Box> = {}, lrot = 0) {
          const [x, z] = W(lx, lz);
          self.addBox({ x, y: base + ly, z, sx, sy, sz, rot: rot + lrot, mat, ...f });
        },
        prop(type: string, lx: number, lz: number, lrot = 0, scale = 1, radius = 0, extra: Partial<Prop> = {}, ly = 0, height = 2) {
          const [x, z] = W(lx, lz);
          self.addProp({ type, x, y: base + ly, z, rot: rot + lrot, scale, ...extra }, radius, height);
        },
        crate(lx: number, lz: number, ly = 0, special?: ItemId) {
          const [x, z] = W(lx, lz);
          self.addNode('crate', x, z, { y: base + ly, rot: rot + rng() * 0.8 - 0.4, special, variant: special ? 1 : 0 });
        },
        /** Rectangular building with a door gap in the +z wall. */
        house(lx: number, lz: number, w: number, d: number, h: number, o: { mat: string; roof: 'gable' | 'flat' | 'none'; ruined: number; lrot?: number }) {
          const hr = o.lrot ?? 0;
          const hc = Math.cos(hr), hs = Math.sin(hr);
          const L = (ax: number, az: number): Pt => { const [qx, qz] = toWorld(ax, az, hc, hs); return [lx + qx, lz + qz]; };
          const t = 0.3;
          const [fx, fz] = L(0, 0);
          api.box(fx, 0, fz, w, 0.16, d, 'floor', { walk: true }, hr);
          const seg = (ax: number, az: number, len: number, along: 'x' | 'z') => {
            const n = Math.max(1, Math.round(len / 2.1));
            const sl = len / n;
            for (let i = 0; i < n; i++) {
              const off = -len / 2 + sl * (i + 0.5);
              let hh = h;
              if (o.ruined > 0) {
                const r1 = rng(), r2 = rng();
                if (r1 < o.ruined * 0.22) continue;
                if (r2 < o.ruined) hh = h * (0.25 + rng() * 0.6);
              }
              const [px, pz] = along === 'x' ? L(ax + off, az) : L(ax, az + off);
              api.box(px, 0.16, pz, along === 'x' ? sl : t, hh, along === 'x' ? t : sl, o.mat, { solid: true }, hr);
            }
          };
          const dw = 1.7;
          seg(0, -d / 2, w, 'x');
          seg(-w / 2, 0, d, 'z');
          seg(w / 2, 0, d, 'z');
          const side = (w - dw) / 2;
          seg(-(dw / 2 + side / 2), d / 2, side, 'x');
          seg(dw / 2 + side / 2, d / 2, side, 'x');
          if (o.ruined < 0.3) {
            const [px, pz] = L(0, d / 2);
            api.box(px, 2.35, pz, dw, h - 2.19, t, o.mat, { solid: true }, hr);
          }
          if (o.roof === 'gable') { const [px, pz] = L(0, 0); api.box(px, h + 0.16, pz, w + 0.9, h * 0.5, d + 0.9, 'roof', { shape: 'gable' }, hr); }
          else if (o.roof === 'flat') { const [px, pz] = L(0, 0); api.box(px, h + 0.16, pz, w + 0.5, 0.25, d + 0.5, 'roofflat', {}, hr); }
          return L;
        },
      };
      return api;
    }

    const poi = (id: string) => this.pois.find((p) => p.id === id)!;

    // --- survivors' camp
    {
      const p = poi('camp');
      const s = site(p.x, p.z, 0.3, p.h);
      s.prop('firepit', 0, 0, 0, 1, 0.75, { use: 'firepit' }, 0, 0.6);
      s.prop('tent', -5.2, -3.2, 1.0, 1, 1.7);
      s.prop('tent', 5.4, -2.6, -1.1, 1, 1.7);
      s.prop('tent', 0.5, -6.6, 0.05, 1.05, 1.7);
      s.prop('log', -2.6, 2.2, 0.9, 1, 0.45, {}, 0, 0.6);
      s.prop('log', 2.9, 1.9, -0.8, 1, 0.45, {}, 0, 0.6);
      s.prop('barrel', 6.8, 2.6, 0, 1, 0.45, {}, 0, 1.1);
      s.prop('lantern', -6.5, 1.5, 0, 1, 0.15, {}, 0, 2.5);
      s.crate(7.6, 4.1);
      s.crate(-7.4, -0.2);
    }
    // --- research station
    {
      const p = poi('station');
      const s = site(p.x, p.z, -0.75, p.h);
      const L = s.house(0, -3, 16, 10, 3.5, { mat: 'concrete', roof: 'flat', ruined: 0 });
      { const [x, z] = L(-5, -3.6); s.prop('radio', x, z, 0, 1, 0.9, { use: 'radio' }, 0.16); }
      { const [x, z] = L(3.5, -3.9); s.prop('desk', x, z, 0, 1, 0.9, {}, 0.16, 1); }
      { const [x, z] = L(6.6, 1.5); s.prop('shelf', x, z, Math.PI / 2, 1, 0.7, {}, 0.16); }
      { const [x, z] = L(-6.4, 2.6); s.crate(x, z, 0.16); }
      { const [x, z] = L(5.2, -1.2); s.crate(x, z, 0.16); }
      s.prop('dish', 4.5, -4, 0.6, 1, 0, {}, 3.9);
      s.prop('antenna', -11.5, -4.5, 0, 1, 0.7, {}, 0, 20);
      const L2 = s.house(12, 9, 6, 5, 2.9, { mat: 'metal', roof: 'flat', ruined: 0, lrot: -Math.PI / 2 });
      { const [x, z] = L2(-1.6, -1.2); s.crate(x, z, 0.16, 'tube'); }
      s.prop('barrel', 8.2, 5.2, 0, 1, 0.45, {}, 0, 1.1);
      s.prop('barrel', 9.1, 5.9, 0, 1, 0.45, {}, 0, 1.1);
      s.prop('generator', -6.5, 5.2, 0.3, 1, 1.0, {}, 0, 1.4);
      // perimeter fence with gaps
      const R = 22;
      for (let i = 0; i < 20; i++) {
        if (i === 3 || i === 4 || i === 11 || i === 16) continue;
        const a = (i / 20) * Math.PI * 2;
        const lx = Math.sin(a) * R, lz = Math.cos(a) * R;
        s.box(lx, 0, lz, 6.6, 1.9, 0.14, 'fence', { solid: true }, a);
      }
      s.crate(-14, 9);
    }
    // --- watchtower
    {
      const p = poi('tower');
      const s = site(p.x, p.z, 0.5, p.h);
      const H = 9;
      for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as Pt[]) s.box(lx, 0, lz, 0.38, H, 0.38, 'wood', { solid: true });
      for (const [lx, lz, sx, sz] of [[0, -2, 4, 0.16], [0, 2, 4, 0.16], [-2, 0, 0.16, 4], [2, 0, 0.16, 4]] as number[][]) {
        s.box(lx, 3, lz, sx, 0.2, sz, 'wood'); s.box(lx, 6, lz, sx, 0.2, sz, 'wood');
      }
      s.box(0, H, 0, 5.4, 0.25, 5.4, 'plank', { walk: true });
      const top = H + 0.25;
      s.box(0, top, -2.6, 5.4, 1.05, 0.14, 'wood', { solid: true });
      s.box(-2.6, top, 0, 0.14, 1.05, 5.4, 'wood', { solid: true });
      s.box(2.6, top, 0, 0.14, 1.05, 5.4, 'wood', { solid: true });
      s.box(-1.75, top, 2.6, 1.9, 1.05, 0.14, 'wood', { solid: true });
      s.box(1.75, top, 2.6, 1.9, 1.05, 0.14, 'wood', { solid: true });
      for (const [lx, lz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]] as Pt[]) s.box(lx, top, lz, 0.2, 2.5, 0.2, 'wood');
      s.box(0, top + 2.5, 0, 6.4, 1.5, 6.4, 'roof', { shape: 'gable' });
      s.prop('ladder', 0, 2.95, 0, 1, 0, { use: 'ladder', top: p.h + top }, 0);
      s.crate(-1.5, -1.5, top, 'battery');
      s.crate(4.5, -3.5);
    }
    // --- abandoned village
    {
      const p = poi('village');
      const s = site(p.x, p.z, 0.2, p.h);
      const defs: [number, number, number, number, number, number][] = [
        [-16, -12, 9, 7, 0.3, 0.45], [6, -17, 8, 7, -0.2, 0.7], [19, 2, 10, 7, 1.4, 0.35],
        [-18, 12, 8, 8, 2.7, 0.85], [3, 17, 9, 6, 3.3, 0.55],
      ];
      const inner: Pt[] = [];
      defs.forEach(([lx, lz, w, d, r, ruin], i) => {
        const L = s.house(lx, lz, w, d, 3.1, { mat: i % 2 ? 'plank' : 'oldwood', roof: ruin < 0.5 ? 'gable' : 'none', ruined: ruin, lrot: r });
        inner.push(L(-w / 2 + 1.3, -d / 2 + 1.3));
        if (i === 0) { const [x, z] = L(w / 2 - 1.4, -d / 2 + 1.2); s.prop('shelf', x, z, r, 1, 0.6, {}, 0.16); }
      });
      inner.forEach(([x, z], i) => s.crate(x, z, 0.16, i === 3 ? 'cable' : undefined));
      s.prop('car', 2, -3, 0.5, 1, 1.9, {}, 0, 1.6);
      s.prop('well', -5, 2, 0, 1, 1.2, {}, 0, 1.2);
      s.prop('barrel', 10, -7, 0, 1, 0.45, {}, 0, 1.1);
      s.prop('barrel', -9, 20, 0, 1, 0.45, {}, 0, 1.1);
      s.crate(11, 10);
    }
    // --- fisherman's cabin and pier
    {
      const p = poi('cabin');
      const s = site(p.x, p.z, -Math.PI / 2, p.h);
      const L = s.house(0, 0, 6, 5, 2.9, { mat: 'plank', roof: 'gable', ruined: 0 });
      { const [x, z] = L(-1.8, -1.3); s.crate(x, z, 0.16); }
      s.prop('barrel', 4.2, -1, 0, 1, 0.45, {}, 0, 1.1);
      // pier heading east into the lake (independent of site rotation)
      const top = 0.95;
      this.addBox({ x: p.x + 20, y: top - 0.25, z: p.z - 9, sx: 22, sy: 0.25, sz: 2.6, rot: 0.25, mat: 'plank', walk: true });
    }
    // --- bridge
    {
      const b = BRIDGE;
      this.addBox({ x: b.x, y: b.top - 0.3, z: b.z, sx: b.len, sy: 0.3, sz: b.width, rot: b.rot, mat: 'plank', walk: true });
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      for (const side of [-1, 1]) {
        const [ox, oz] = toWorld(0, side * (b.width / 2 - 0.08), c, s);
        this.addBox({ x: b.x + ox, y: b.top + 0.85, z: b.z + oz, sx: b.len, sy: 0.14, sz: 0.14, rot: b.rot, mat: 'wood' });
        this.colliders.add(ColliderGrid.obb(b.x + ox, b.z + oz, b.len / 2, 0.1, b.rot, b.top - 0.2, b.top + 1, 'static'));
        for (let i = -3; i <= 3; i++) {
          const [px, pz] = toWorld(i * (b.len / 6.2), side * (b.width / 2 - 0.08), c, s);
          this.addBox({ x: b.x + px, y: -2.2, z: b.z + pz, sx: 0.26, sy: b.top + 3.2, sz: 0.26, rot: b.rot, mat: 'wood' });
        }
      }
    }
  }

  // ------------------------------------------------------------ nodes
  private scatterNodes() {
    const rng = mulberry32(this.seed + 4242);
    const s = this.seed;
    const free = (x: number, z: number, pad: number, pathPad: number) => {
      if (Math.hypot(x, z) > PLAY_RADIUS - 4) return false;
      if (this.poiAt(x, z, pad)) return false;
      if (this.pathDist(x, z) < pathPad) return false;
      const d = Math.hypot(x - BRIDGE.x, z - BRIDGE.z);
      if (d < 17) return false;
      return true;
    };

    // trees on a jittered grid, density driven by noise
    const step = 7;
    for (let gz = -WORLD_HALF; gz < WORLD_HALF; gz += step) for (let gx = -WORLD_HALF; gx < WORLD_HALF; gx += step) {
      const x = gx + rng() * step, z = gz + rng() * step;
      const roll = rng(), r2 = rng(), r3 = rng(), r4 = rng();
      if (!free(x, z, 3, 3.6)) continue;
      const h = this.heightAt(x, z);
      if (h < 0.7 || h > 58) continue;
      if (this.slopeAt(x, z) > 0.95) continue;
      const f = fbm(x * 0.008 + 100, z * 0.008, 3, s + 11);
      let p = smoothstep(0.36, 0.6, f) * 0.6 + 0.1;
      p *= 1 - smoothstep(36, 58, h);
      const campD = Math.hypot(x - CAMP.x, z - CAMP.z);
      if (campD < 60) p = Math.max(p, 0.3);
      if (roll > p) continue;
      const zone = this.zoneAt(x, z);
      let variant = r2 < 0.62 ? 0 : r2 < 0.86 ? 1 : 2;
      if (h > 26 && r2 < 0.8) variant = 1;
      if (h < 3.5 && r3 < 0.45) variant = 2;
      if (zone?.kind === 'radiation' && r3 < 0.75) variant = 3;
      this.addNode('tree', x, z, { variant, rot: r4 * 6.283, scale: 0.8 + r3 * 0.55 });
    }

    const scatter = (kind: NodeKind, count: number, ok: (x: number, z: number, h: number) => boolean,
      sample: () => Pt = () => [(rng() * 2 - 1) * PLAY_RADIUS, (rng() * 2 - 1) * PLAY_RADIUS], scale: () => number = () => 1, variants = 1) => {
      let placed = 0;
      for (let tries = 0; tries < count * 30 && placed < count; tries++) {
        const [x, z] = sample();
        const rot = rng() * 6.283, sc = scale(), v = Math.floor(rng() * variants);
        if (!free(x, z, 1.5, 2.2)) continue;
        const h = this.heightAt(x, z);
        if (h < 0.45 || !ok(x, z, h)) continue;
        if (this.colliders.overlaps(x, z, kind === 'rock' ? 1.6 : 0.7, h - 1, h + 2)) continue;
        this.addNode(kind, x, z, { rot, scale: sc, variant: v });
        placed++;
      }
    };
    const ring = (cx: number, cz: number, r0: number, r1: number) => (): Pt => {
      const a = rng() * 6.283, r = r0 + rng() * (r1 - r0);
      return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
    };
    const gentle = (x: number, z: number, h: number) => h < 50 && this.slopeAt(x, z) < 0.8;

    scatter('rock', 300, (x, z, h) => h < 62, undefined, () => 0.7 + rng() * 1.1, 3);
    scatter('rock', 10, gentle, ring(CAMP.x, CAMP.z, 20, 55), () => 0.8 + rng() * 0.5, 3);
    scatter('stone', 190, gentle);
    scatter('stone', 70, gentle, () => {
      const i = Math.floor(rng() * (RIVER.length - 1)), t = rng();
      const x = lerp(RIVER[i][0], RIVER[i + 1][0], t), z = lerp(RIVER[i][1], RIVER[i + 1][1], t);
      const a = rng() * 6.283, r = 9 + rng() * 9;
      return [x + Math.cos(a) * r, z + Math.sin(a) * r];
    });
    scatter('stone', 14, gentle, ring(CAMP.x, CAMP.z, 14, 42));
    scatter('stick', 220, gentle);
    scatter('stick', 14, gentle, ring(CAMP.x, CAMP.z, 14, 42));
    scatter('fiber', 380, gentle, undefined, () => 0.85 + rng() * 0.4);
    scatter('fiber', 18, gentle, ring(CAMP.x, CAMP.z, 14, 45), () => 0.9 + rng() * 0.3);
    scatter('berry', 140, gentle, undefined, () => 0.9 + rng() * 0.3);
    scatter('berry', 8, gentle, ring(CAMP.x, CAMP.z, 18, 50));
    scatter('crate', 14, (x, z, h) => gentle(x, z, h) && Math.hypot(x - CAMP.x, z - CAMP.z) > 90);
    // touch hash2 so tree-shaking never changes module evaluation order between builds
    void hash2;
  }
}
