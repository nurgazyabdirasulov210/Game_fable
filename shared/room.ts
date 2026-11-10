// Authoritative room simulation. The Socket.IO server runs one Room per game room;
// the single-player client runs the very same class in-process.
import { angleDiff, clamp, mulberry32 } from './rng';
import {
  BUILD_BY_TYPE, CHEST_SLOTS, CRATE_LOOT, HAND_TOOL, ITEMS,
  type BuildType, type ItemId, type Stack,
} from './items';
import { ColliderGrid, PLAY_RADIUS, World, toWorld, type Collider, type NodeDef, type Platform } from './world';

export const MAX_PLAYERS = 4;
export const DAY_LENGTH = 720; // seconds per in-game day
export const TX_DURATION = 75;

export type EnemyType = 'wolf' | 'deer' | 'mutant' | 'stalker';
export const ENEMY_TYPES: EnemyType[] = ['wolf', 'deer', 'mutant', 'stalker'];
export type WeatherType = 'clear' | 'rain' | 'fog' | 'storm';

export const ENEMY_DEF: Record<EnemyType, { name: string; hp: number; dmg: number; speed: number; walk: number; sight: number; range: number; cool: number }> = {
  wolf: { name: 'Волк', hp: 40, dmg: 8, speed: 6.3, walk: 2.0, sight: 17, range: 1.9, cool: 1.3 },
  deer: { name: 'Олень', hp: 30, dmg: 0, speed: 7.0, walk: 1.6, sight: 13, range: 0, cool: 0 },
  mutant: { name: 'Мутант', hp: 95, dmg: 15, speed: 4.7, walk: 1.4, sight: 15, range: 2.0, cool: 1.7 },
  stalker: { name: 'Ночной охотник', hp: 150, dmg: 22, speed: 6.8, walk: 2.4, sight: 40, range: 2.1, cool: 1.5 },
};

export interface PlayerNet {
  id: string; name: string; color: number;
  x: number; y: number; z: number; ry: number;
  anim: number; held: ItemId | null; dead: boolean;
}

export interface BuildingNet {
  id: number; type: BuildType; x: number; y: number; z: number; rot: number;
  open?: boolean; items?: (Stack | null)[];
}

export interface RadioState { parts: { battery: boolean; cable: boolean; tube: boolean }; state: 'broken' | 'ready' | 'tx' | 'done'; progress: number }

/** [id, typeIndex, x, y, z, ry, hpFraction, anim] ; anim: 0 idle 1 walk 2 run 3 attack 4 dead */
export type EnemyNet = [number, number, number, number, number, number, number, number];

export interface Snapshot {
  seed: number; you: string; code: string;
  players: PlayerNet[];
  nodes: [number, number, number][]; // id, hp, depleted
  buildings: BuildingNet[];
  enemies: EnemyNet[];
  time: number; day: number; weather: WeatherType;
  radio: RadioState;
}

export interface RoomSave {
  clock: number; time: number; day: number; weather: WeatherType; weatherUntil: number;
  nodes: [number, number, number][]; // id, hp, respawnAt (0 = alive)
  buildings: BuildingNet[]; radio: RadioState; nextId: number;
}

interface Enemy {
  id: number; type: EnemyType; x: number; y: number; z: number; ry: number; hp: number;
  state: 'idle' | 'wander' | 'chase' | 'windup' | 'cooldown' | 'flee' | 'dead';
  t: number; target: string | null; tx: number; tz: number;
  hx: number; hz: number; hr: number; zone: number; anim: number; wave?: boolean;
}

export const PLAYER_COLORS = [0xf2a93b, 0x4fb3d9, 0xd95f5f, 0x8fce5a];

export function nodeMaxHp(n: NodeDef): number {
  if (n.kind === 'tree') return Math.round(8 * n.scale);
  if (n.kind === 'rock') return Math.round(9 * n.scale);
  return 1;
}

// ------------------------------------------------------------------ building rules
export interface Placement { ok: boolean; y: number; reason?: string }

const FOUND_HALF = 2;

export function foundationCorners(x: number, z: number, rot: number): [number, number][] {
  const c = Math.cos(rot), s = Math.sin(rot);
  const pts: [number, number][] = [[0, 0]];
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const [wx, wz] = toWorld(lx * FOUND_HALF, lz * FOUND_HALF, c, s);
    pts.push([x + wx, z + wz]);
  }
  return pts;
}

/**
 * Validate a building placement. `yHint` is used for foundations snapped level with a neighbour;
 * `refY` is the builder's feet height (so pieces land on the floor the builder stands on).
 */
export function checkPlacement(world: World, buildings: Iterable<BuildingNet>, type: BuildType,
  x: number, z: number, rot: number, refY: number, yHint?: number): Placement {
  if (Math.hypot(x, z) > PLAY_RADIUS - 6) return { ok: false, y: 0, reason: 'Край карты' };
  if (type === 'foundation') {
    let mn = Infinity, mx = -Infinity;
    for (const [px, pz] of foundationCorners(x, z, rot)) {
      const h = world.heightAt(px, pz);
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    if (mn < 0.25) return { ok: false, y: 0, reason: 'Слишком близко к воде' };
    let y = mx + 0.35;
    if (yHint !== undefined && yHint >= mx + 0.05 && yHint <= mn + 3.2) y = yHint;
    if (y > mn + 3.2) return { ok: false, y, reason: 'Слишком крутой склон' };
    for (const b of buildings) {
      if (b.type === 'foundation' && Math.hypot(b.x - x, b.z - z) < 3.9) return { ok: false, y, reason: 'Место занято' };
      if (b.type !== 'foundation' && b.type !== 'wall' && b.type !== 'door' && Math.hypot(b.x - x, b.z - z) < 2.6 && b.y < y - 0.05) return { ok: false, y, reason: 'Место занято' };
    }
    if (world.colliders.overlaps(x, z, 2.1, y - 4, y + 2, 'build')) return { ok: false, y, reason: 'Мешает объект' };
    return { ok: true, y };
  }
  const y = world.groundAt(x, z, refY + 1.2);
  if (y < 0.3) return { ok: false, y, reason: 'Нельзя строить в воде' };
  if (type === 'wall' || type === 'door') {
    for (const b of buildings) {
      if ((b.type === 'wall' || b.type === 'door') && Math.hypot(b.x - x, b.z - z) < 1.2 && Math.abs(b.y - y) < 2) return { ok: false, y, reason: 'Место занято' };
    }
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const off of [-1.4, 0, 1.4]) {
      const [wx, wz] = toWorld(off, 0, c, s);
      if (world.colliders.overlaps(x + wx, z + wz, 0.25, y + 0.3, y + 2.5, 'build')) return { ok: false, y, reason: 'Мешает объект' };
      if (Math.abs(world.groundAt(x + wx, z + wz, refY + 1.2) - y) > 1.3) return { ok: false, y, reason: 'Неровная поверхность' };
    }
    return { ok: true, y };
  }
  for (const b of buildings) {
    if (b.type !== 'foundation' && Math.hypot(b.x - x, b.z - z) < 1.5 && Math.abs(b.y - y) < 2) return { ok: false, y, reason: 'Место занято' };
  }
  if (world.colliders.overlaps(x, z, 0.7, y + 0.1, y + 1.5)) return { ok: false, y, reason: 'Мешает объект' };
  if (world.slopeAt(x, z) > 0.7 && y <= world.heightAt(x, z) + 0.01) return { ok: false, y, reason: 'Слишком крутой склон' };
  return { ok: true, y };
}

export interface BuildPhysics { cols: Collider[]; plat?: Platform; door?: Collider }

export function addBuildingPhysics(world: World, b: BuildingNet): BuildPhysics {
  const g = world.colliders;
  const out: BuildPhysics = { cols: [] };
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  if (b.type === 'foundation') {
    out.plat = world.addPlatform(b.x, b.z, FOUND_HALF, FOUND_HALF, b.rot, b.y, b.id);
    out.cols.push(g.add(ColliderGrid.obb(b.x, b.z, FOUND_HALF, FOUND_HALF, b.rot, b.y - 6, b.y, 'build')));
  } else if (b.type === 'wall') {
    out.cols.push(g.add(ColliderGrid.obb(b.x, b.z, 2, 0.16, b.rot, b.y, b.y + 3, 'build')));
  } else if (b.type === 'door') {
    for (const sx of [-1.35, 1.35]) {
      const [wx, wz] = toWorld(sx, 0, c, s);
      out.cols.push(g.add(ColliderGrid.obb(b.x + wx, b.z + wz, 0.65, 0.16, b.rot, b.y, b.y + 3, 'build')));
    }
    out.door = g.add(ColliderGrid.obb(b.x, b.z, 0.7, 0.12, b.rot, b.y, b.y + 2.3, 'build'));
    out.door.on = !b.open;
    out.cols.push(out.door);
  } else if (b.type === 'campfire') {
    out.cols.push(g.add(ColliderGrid.circle(b.x, b.z, 0.55, b.y, b.y + 0.6, 'build')));
  } else if (b.type === 'chest') {
    out.cols.push(g.add(ColliderGrid.circle(b.x, b.z, 0.6, b.y, b.y + 0.9, 'build')));
  }
  return out;
}

export function removeBuildingPhysics(world: World, p: BuildPhysics) {
  for (const c of p.cols) world.colliders.remove(c);
  if (p.plat) world.removePlatform(p.plat);
}

// ------------------------------------------------------------------ room
export type Emit = (to: string | null, type: string, data: any) => void;

export class Room {
  world: World;
  players = new Map<string, PlayerNet>();
  nodeHp = new Map<number, number>();
  depleted = new Map<number, number>();
  buildings = new Map<number, BuildingNet>();
  private phys = new Map<number, BuildPhysics>();
  enemies: Enemy[] = [];
  radio: RadioState = { parts: { battery: false, cable: false, tube: false }, state: 'broken', progress: 0 };
  clock = 0;
  time = 7.5;
  day = 1;
  weather: WeatherType = 'clear';
  weatherUntil = 200;
  dayLength = DAY_LENGTH;
  debug = false;
  private nextId = 1;
  private rng: () => number;
  private acc = { net: 0, env: 0, respawn: 0, stalker: 10, wave: 0, players: 0 };
  private zoneRespawn: number[] = [];
  private fires: { x: number; z: number }[] = [];
  private tmpNodes: NodeDef[] = [];

  constructor(public code: string, private emit: Emit, world?: World, save?: RoomSave) {
    this.world = world ?? new World();
    this.rng = mulberry32((Date.now() ^ (code.charCodeAt(0) * 7919)) >>> 0);
    if (save) this.load(save);
    this.world.spawnZones.forEach((z, i) => {
      this.zoneRespawn[i] = 0;
      for (let k = 0; k < z.count; k++) this.spawnInZone(i);
    });
    this.refreshFires();
  }

  // ---------------------------------------------------------------- persistence
  serialize(): RoomSave {
    const nodes: [number, number, number][] = [];
    const seen = new Set<number>();
    for (const [id, at] of this.depleted) { nodes.push([id, 0, at]); seen.add(id); }
    for (const [id, hp] of this.nodeHp) if (!seen.has(id)) nodes.push([id, hp, 0]);
    return {
      clock: this.clock, time: this.time, day: this.day, weather: this.weather, weatherUntil: this.weatherUntil,
      nodes, buildings: [...this.buildings.values()], radio: this.radio, nextId: this.nextId,
    };
  }

  private load(s: RoomSave) {
    this.clock = s.clock; this.time = s.time; this.day = s.day; this.weather = s.weather; this.weatherUntil = s.weatherUntil;
    this.radio = s.radio; this.nextId = s.nextId;
    if (this.radio.state === 'tx') { this.radio.state = 'ready'; this.radio.progress = 0; }
    for (const [id, hp, at] of s.nodes) {
      if (at) this.setDepleted(id, at); else this.nodeHp.set(id, hp);
    }
    for (const b of s.buildings) { this.buildings.set(b.id, b); this.phys.set(b.id, addBuildingPhysics(this.world, b)); }
  }

  private setDepleted(id: number, at: number) {
    this.depleted.set(id, at);
    this.nodeHp.delete(id);
    const col = this.world.nodeColliders.get(id);
    if (col && this.world.nodes[id].kind !== 'crate') col.on = false;
  }

  snapshot(you: string): Snapshot {
    const nodes: [number, number, number][] = [];
    for (const id of this.depleted.keys()) nodes.push([id, 0, 1]);
    for (const [id, hp] of this.nodeHp) nodes.push([id, hp, 0]);
    return {
      seed: this.world.seed, you, code: this.code,
      players: [...this.players.values()],
      nodes, buildings: [...this.buildings.values()],
      enemies: this.enemyNet(), time: this.time, day: this.day, weather: this.weather, radio: this.radio,
    };
  }

  // ---------------------------------------------------------------- players
  join(id: string, name: string): Snapshot | { error: string } {
    if (this.players.size >= MAX_PLAYERS) return { error: 'Комната заполнена (максимум 4 игрока)' };
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
    const sp = this.world.spawn;
    const a = this.players.size * 1.6;
    const x = sp.x + Math.cos(a) * 2, z = sp.z + Math.sin(a) * 2;
    const p: PlayerNet = { id, name: (name || 'Выживший').slice(0, 16), color, x, y: this.world.heightAt(x, z), z, ry: 0, anim: 0, held: null, dead: false };
    this.players.set(id, p);
    this.emit(null, 'joined', p);
    return this.snapshot(id);
  }

  leave(id: string) {
    if (!this.players.delete(id)) return;
    this.emit(null, 'left', { id });
  }

  // ---------------------------------------------------------------- messages
  handle(pid: string, type: string, d: any) {
    const p = this.players.get(pid);
    if (!p || d == null) return;
    switch (type) {
      case 'state':
        if (![d.x, d.y, d.z, d.ry].every(Number.isFinite)) return;
        p.x = d.x; p.y = d.y; p.z = d.z; p.ry = d.ry; p.anim = d.anim | 0; p.dead = !!d.dead;
        p.held = d.held && ITEMS[d.held as ItemId] ? d.held : null;
        break;
      case 'hit': this.onHit(p, d); break;
      case 'pick': this.onPick(p, d); break;
      case 'attack': this.onAttack(p, d); break;
      case 'build': this.onBuild(p, d); break;
      case 'demolish': this.onDemolish(p, d); break;
      case 'door': {
        const b = this.buildings.get(d.id);
        if (!b || b.type !== 'door' || Math.hypot(b.x - p.x, b.z - p.z) > 6) return;
        b.open = !b.open;
        const ph = this.phys.get(b.id);
        if (ph?.door) ph.door.on = !b.open;
        this.emit(null, 'door', { id: b.id, open: b.open });
        break;
      }
      case 'chestPut': this.onChestPut(p, d); break;
      case 'chestTake': this.onChestTake(p, d); break;
      case 'radio': this.onRadio(p, d); break;
      case 'chat': {
        const text = String(d.text ?? '').slice(0, 140).trim();
        if (text) this.emit(null, 'chat', { id: p.id, name: p.name, color: p.color, text });
        break;
      }
      case 'debug':
        if (!this.debug) return;
        if (typeof d.time === 'number') this.time = d.time;
        if (d.weather) { this.weather = d.weather; this.weatherUntil = this.clock + 120; }
        if (d.spawn) this.spawnEnemy(d.spawn, d.x ?? p.x + 6, d.z ?? p.z, -1);
        if (d.clearEnemies) this.enemies = [];
        this.sendEnv();
        break;
    }
  }

  private near(p: PlayerNet, x: number, z: number, r: number) { return Math.hypot(p.x - x, p.z - z) <= r; }

  private onHit(p: PlayerNet, d: any) {
    const n = this.world.nodes[d.id];
    if (!n || (n.kind !== 'tree' && n.kind !== 'rock') || this.depleted.has(n.id) || p.dead) return;
    if (!this.near(p, n.x, n.z, 5.5)) return;
    const tool = (d.item && ITEMS[d.item as ItemId]?.tool) || HAND_TOOL;
    const power = n.kind === 'tree' ? tool.tree : tool.rock;
    const hp0 = this.nodeHp.get(n.id) ?? nodeMaxHp(n);
    const dealt = Math.min(hp0, power);
    const hp = hp0 - dealt;
    const items: Stack[] = [];
    if (n.kind === 'tree') {
      let wood = dealt;
      if (hp <= 0) wood += 2;
      items.push(['wood', wood]);
      if (hp <= 0 && this.rng() < 0.5) items.push(['fiber', 1]);
    } else {
      let stone = Math.max(1, Math.ceil(dealt / 2));
      if (hp <= 0) stone += 2;
      items.push(['stone', stone]);
    }
    if (hp <= 0) this.setDepleted(n.id, this.clock + (n.kind === 'tree' ? 420 : 540));
    else this.nodeHp.set(n.id, hp);
    this.emit(null, 'node', { id: n.id, hp: Math.max(0, hp), dep: hp <= 0 ? 1 : 0, by: p.id });
    this.emit(p.id, 'loot', { items, src: n.kind });
  }

  private rollCrate(): Stack {
    const total = CRATE_LOOT.reduce((a, l) => a + l.w, 0);
    let r = this.rng() * total;
    for (const l of CRATE_LOOT) {
      r -= l.w;
      if (r <= 0) return [l.item, l.min + Math.floor(this.rng() * (l.max - l.min + 1))];
    }
    return ['wood', 3];
  }

  private onPick(p: PlayerNet, d: any) {
    const n = this.world.nodes[d.id];
    if (!n || n.kind === 'tree' || n.kind === 'rock' || this.depleted.has(n.id) || p.dead) return;
    if (!this.near(p, n.x, n.z, 5) || Math.abs(p.y - n.y) > 3) return;
    const items: Stack[] = [];
    let respawn = 240;
    const ri = (a: number, b: number) => a + Math.floor(this.rng() * (b - a + 1));
    switch (n.kind) {
      case 'stone': items.push(['stone', ri(1, 2)]); break;
      case 'stick': items.push(['wood', 2]); break;
      case 'fiber': items.push(['fiber', ri(2, 3)]); respawn = 180; break;
      case 'berry': items.push(['berries', ri(3, 4)]); break;
      case 'crate': {
        respawn = Infinity;
        if (n.special) items.push([n.special, 1]);
        const rolls = n.special ? 1 : ri(2, 3);
        for (let i = 0; i < rolls; i++) {
          const s = this.rollCrate();
          const ex = items.find((it) => it[0] === s[0]);
          if (ex) ex[1] = Math.min(ITEMS[s[0]].stack, ex[1] + s[1]); else items.push(s);
        }
        break;
      }
    }
    this.setDepleted(n.id, respawn === Infinity ? Number.MAX_SAFE_INTEGER : this.clock + respawn);
    this.emit(null, 'node', { id: n.id, hp: 0, dep: 1, by: p.id });
    this.emit(p.id, 'loot', { items, src: n.kind });
  }

  private onAttack(p: PlayerNet, d: any) {
    const e = this.enemies.find((en) => en.id === d.id);
    if (!e || e.state === 'dead' || p.dead) return;
    const tool = (d.item && ITEMS[d.item as ItemId]?.tool) || HAND_TOOL;
    if (Math.hypot(e.x - p.x, e.z - p.z) > tool.reach + 2.2) return;
    this.damageEnemy(e, tool.dmg, p);
  }

  private damageEnemy(e: Enemy, dmg: number, by: PlayerNet | null) {
    e.hp -= dmg;
    if (by) {
      const dx = e.x - by.x, dz = e.z - by.z, dl = Math.hypot(dx, dz) || 1;
      this.moveEnemy(e, dx / dl, dz / dl, 0.6);
    }
    this.emit(null, 'ehit', { id: e.id, dmg, x: e.x, y: e.y, z: e.z, by: by?.id });
    if (e.hp <= 0) {
      e.hp = 0; e.state = 'dead'; e.t = 0; e.anim = 4;
      if (e.zone >= 0) this.zoneRespawn[e.zone] = Math.max(this.zoneRespawn[e.zone], this.clock) + 100;
      if (by) {
        const items: Stack[] = [];
        const ri = (a: number, b: number) => a + Math.floor(this.rng() * (b - a + 1));
        if (e.type === 'wolf') items.push(['raw_meat', ri(1, 2)]);
        else if (e.type === 'deer') items.push(['raw_meat', ri(2, 3)]);
        else if (e.type === 'mutant') { items.push(['fiber', ri(2, 4)]); if (this.rng() < 0.4) items.push(['bandage', 1]); }
        else if (e.type === 'stalker') items.push(['bandage', 2]);
        this.emit(by.id, 'loot', { items, src: 'kill', enemy: e.type });
      }
    } else if (by) {
      if (e.type === 'deer') { e.state = 'flee'; e.t = 5; e.target = by.id; }
      else if (e.state !== 'windup') { e.state = 'chase'; e.target = by.id; }
    }
  }

  private onBuild(p: PlayerNet, d: any) {
    const type = d.type as BuildType;
    const def = BUILD_BY_TYPE[type];
    const fail = (reason: string) => this.emit(p.id, 'buildFail', { req: d.req, type, reason });
    if (!def || ![d.x, d.z, d.rot].every(Number.isFinite) || p.dead) return fail('Некорректный запрос');
    if (!this.near(p, d.x, d.z, 11)) return fail('Слишком далеко');
    if (this.buildings.size >= 400) return fail('Достигнут лимит построек');
    const pl = checkPlacement(this.world, this.buildings.values(), type, d.x, d.z, d.rot, p.y, Number.isFinite(d.y) ? d.y : undefined);
    if (!pl.ok) return fail(pl.reason ?? 'Нельзя построить здесь');
    const b: BuildingNet = { id: this.nextId++, type, x: d.x, y: pl.y, z: d.z, rot: d.rot };
    if (type === 'door') b.open = false;
    if (type === 'chest') b.items = new Array(CHEST_SLOTS).fill(null);
    this.buildings.set(b.id, b);
    this.phys.set(b.id, addBuildingPhysics(this.world, b));
    if (type === 'campfire') this.refreshFires();
    this.emit(null, 'built', { b, by: p.id, req: d.req });
  }

  private onDemolish(p: PlayerNet, d: any) {
    const b = this.buildings.get(d.id);
    if (!b || !this.near(p, b.x, b.z, 8)) return;
    this.buildings.delete(b.id);
    const ph = this.phys.get(b.id);
    if (ph) removeBuildingPhysics(this.world, ph);
    this.phys.delete(b.id);
    if (b.type === 'campfire') this.refreshFires();
    const items: Stack[] = [];
    for (const [k, v] of Object.entries(BUILD_BY_TYPE[b.type].cost)) {
      const n = Math.floor((v as number) / 2);
      if (n > 0) items.push([k as ItemId, n]);
    }
    if (b.items) for (const s of b.items) if (s) items.push([s[0], s[1]]);
    this.emit(null, 'removed', { id: b.id, by: p.id });
    this.emit(p.id, 'loot', { items, src: 'demolish' });
  }

  private onChestPut(p: PlayerNet, d: any) {
    const b = this.buildings.get(d.id);
    const def = ITEMS[d.item as ItemId];
    let n = Math.floor(d.n);
    if (!def || !(n > 0)) return;
    if (!b || !b.items || !this.near(p, b.x, b.z, 7)) { this.emit(p.id, 'loot', { items: [[def.id, n]], src: 'refund' }); return; }
    for (let i = 0; i < b.items.length && n > 0; i++) {
      const s = b.items[i];
      if (s && s[0] === def.id && s[1] < def.stack) { const m = Math.min(n, def.stack - s[1]); s[1] += m; n -= m; }
    }
    for (let i = 0; i < b.items.length && n > 0; i++) {
      if (!b.items[i]) { const m = Math.min(n, def.stack); b.items[i] = [def.id, m]; n -= m; }
    }
    if (n > 0) this.emit(p.id, 'loot', { items: [[def.id, n]], src: 'refund' });
    this.emit(null, 'chest', { id: b.id, items: b.items });
  }

  private onChestTake(p: PlayerNet, d: any) {
    const b = this.buildings.get(d.id);
    if (!b || !b.items || !this.near(p, b.x, b.z, 7)) return;
    const s = b.items[d.slot | 0];
    if (!s) return;
    b.items[d.slot | 0] = null;
    this.emit(null, 'chest', { id: b.id, items: b.items });
    this.emit(p.id, 'loot', { items: [s], src: 'chest', chest: b.id });
  }

  private onRadio(p: PlayerNet, d: any) {
    const st = this.world.pois.find((q) => q.id === 'station')!;
    if (!this.near(p, st.x, st.z, 30)) return;
    if (d.action === 'install' && this.radio.state === 'broken') {
      const part = d.part as 'battery' | 'cable' | 'tube';
      if (!(part in this.radio.parts) || this.radio.parts[part]) { this.emit(p.id, 'loot', { items: [[part, 1]], src: 'refund' }); return; }
      this.radio.parts[part] = true;
      if (this.radio.parts.battery && this.radio.parts.cable && this.radio.parts.tube) this.radio.state = 'ready';
      this.emit(null, 'radio', { radio: this.radio, by: p.id, part });
    } else if (d.action === 'activate' && this.radio.state === 'ready') {
      this.radio.state = 'tx'; this.radio.progress = 0; this.acc.wave = 4;
      this.emit(null, 'radio', { radio: this.radio, by: p.id });
    }
  }

  // ---------------------------------------------------------------- enemies
  private refreshFires() {
    this.fires = this.world.props.filter((p) => p.use === 'firepit').map((p) => ({ x: p.x, z: p.z }));
    for (const b of this.buildings.values()) if (b.type === 'campfire') this.fires.push({ x: b.x, z: b.z });
  }

  private walkable(x: number, z: number): boolean {
    if (Math.hypot(x, z) > PLAY_RADIUS - 3) return false;
    return this.world.heightAt(x, z) > 0.2 && this.world.slopeAt(x, z) < 1.0;
  }

  spawnEnemy(type: EnemyType, x: number, z: number, zone: number, hr = 30): Enemy {
    const e: Enemy = {
      id: this.nextId++, type, x, z, y: this.world.heightAt(x, z), ry: this.rng() * 6.28, hp: ENEMY_DEF[type].hp,
      state: 'idle', t: this.rng() * 3, target: null, tx: x, tz: z, hx: x, hz: z, hr, zone, anim: 0,
    };
    this.enemies.push(e);
    return e;
  }

  private spawnInZone(i: number) {
    const z = this.world.spawnZones[i];
    for (let k = 0; k < 20; k++) {
      const a = this.rng() * 6.283, r = Math.sqrt(this.rng()) * z.r;
      const x = z.x + Math.cos(a) * r, zz = z.z + Math.sin(a) * r;
      if (!this.walkable(x, zz) || this.world.colliders.overlaps(x, zz, 0.6, -50, 200)) continue;
      const e = this.spawnEnemy(z.type, x, zz, i, z.r);
      e.hx = z.x; e.hz = z.z;
      return;
    }
  }

  private moveEnemy(e: Enemy, dx: number, dz: number, dist: number): boolean {
    const tryDir = (ax: number, az: number): boolean => {
      const nx = e.x + ax * dist, nz = e.z + az * dist;
      if (Math.hypot(nx, nz) > PLAY_RADIUS - 2) return false;
      const g = this.world.groundAt(nx, nz, e.y);
      if (g < -0.25) return false;
      if (g - e.y > dist * 1.5 + 0.12) return false;
      const o = { x: nx, z: nz };
      this.world.colliders.resolve(o, 0.45, g, 1.4);
      const g2 = this.world.groundAt(o.x, o.z, e.y);
      if (g2 < -0.25) return false;
      e.x = o.x; e.z = o.z; e.y = g2;
      return true;
    };
    if (tryDir(dx, dz)) return true;
    const c = 0.5, s = 0.866;
    if (tryDir(dx * c - dz * s, dx * s + dz * c)) return true;
    if (tryDir(dx * c + dz * s, -dx * s + dz * c)) return true;
    return false;
  }

  private steer(e: Enemy, tx: number, tz: number, speed: number, dt: number): number {
    const dx = tx - e.x, dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    const want = Math.atan2(dx, dz);
    e.ry += clamp(angleDiff(e.ry, want), -8 * dt, 8 * dt);
    this.moveEnemy(e, dx / d, dz / d, Math.min(d, speed * dt));
    return d;
  }

  private nearestPlayer(x: number, z: number): { p: PlayerNet | null; d: number } {
    let best: PlayerNet | null = null, bd = Infinity;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return { p: best, d: bd };
  }

  private isNight() { return this.time >= 21 || this.time < 4.75; }

  private tickEnemy(e: Enemy, dt: number) {
    const def = ENEMY_DEF[e.type];
    if (e.state === 'dead') { e.t += dt; return; }
    const { p: np, d: nd } = this.nearestPlayer(e.x, e.z);
    if (!np || nd > 150) { e.anim = 0; return; }
    if (e.type === 'stalker' && !this.isNight()) { this.damageEnemy(e, 60 * dt, null); }
    let sight = def.sight * (this.weather === 'fog' ? 0.6 : 1);
    if (np.anim === 0 && e.type !== 'stalker') sight *= 0.85;
    const tp = e.target ? this.players.get(e.target) : null;

    switch (e.state) {
      case 'idle':
      case 'wander': {
        if (nd < sight && Math.abs(np.y - e.y) < 6) {
          if (e.type === 'deer') { e.state = 'flee'; e.t = 4; e.target = np.id; }
          else { e.state = 'chase'; e.target = np.id; this.emit(null, 'egrowl', { id: e.id, type: e.type, x: e.x, z: e.z }); }
          break;
        }
        if (e.state === 'idle') {
          e.anim = 0; e.t -= dt;
          if (e.t <= 0) {
            const a = this.rng() * 6.283, r = this.rng() * e.hr;
            e.tx = e.hx + Math.cos(a) * r; e.tz = e.hz + Math.sin(a) * r;
            if (this.walkable(e.tx, e.tz)) { e.state = 'wander'; e.t = 14; }
            else e.t = 1;
          }
        } else {
          e.anim = 1; e.t -= dt;
          const d = this.steer(e, e.tx, e.tz, def.walk, dt);
          if (d < 0.8 || e.t <= 0) { e.state = 'idle'; e.t = 2 + this.rng() * 5; }
        }
        break;
      }
      case 'chase': {
        if (!tp || tp.dead) { e.state = 'idle'; e.t = 1; e.target = null; break; }
        const d = Math.hypot(tp.x - e.x, tp.z - e.z);
        const leash = e.type === 'stalker' || e.wave ? 400 : 85;
        if (d > sight * 2.2 || Math.hypot(e.x - e.hx, e.z - e.hz) > leash) {
          e.state = 'wander'; e.tx = e.hx; e.tz = e.hz; e.t = 30; e.target = null; break;
        }
        if (d < def.range && Math.abs(tp.y - e.y) < 2.2) { e.state = 'windup'; e.t = 0.42; e.anim = 3; break; }
        e.anim = 2;
        if (e.type === 'stalker') {
          // night stalkers fear fire: they will not step into the light of a campfire
          let afraid = false;
          for (const f of this.fires) {
            if (Math.hypot(tp.x - f.x, tp.z - f.z) < 7 && Math.hypot(e.x - f.x, e.z - f.z) < 10) { afraid = true; break; }
          }
          if (afraid) { e.anim = 0; e.ry += clamp(angleDiff(e.ry, Math.atan2(tp.x - e.x, tp.z - e.z)), -4 * dt, 4 * dt); break; }
        }
        this.steer(e, tp.x, tp.z, def.speed, dt);
        break;
      }
      case 'windup': {
        e.t -= dt; e.anim = 3;
        if (tp) e.ry += clamp(angleDiff(e.ry, Math.atan2(tp.x - e.x, tp.z - e.z)), -10 * dt, 10 * dt);
        if (e.t <= 0) {
          if (tp && !tp.dead && Math.hypot(tp.x - e.x, tp.z - e.z) < def.range + 0.9 && Math.abs(tp.y - e.y) < 2.4) {
            this.emit(tp.id, 'hurt', { dmg: def.dmg, by: e.type, x: e.x, z: e.z });
          }
          e.state = 'cooldown'; e.t = def.cool;
        }
        break;
      }
      case 'cooldown': {
        e.t -= dt; e.anim = 0;
        if (e.t <= 0) e.state = 'chase';
        break;
      }
      case 'flee': {
        e.t -= dt; e.anim = 2;
        const src = tp ?? np;
        const dx = e.x - src.x, dz = e.z - src.z, d = Math.hypot(dx, dz) || 1;
        this.steer(e, e.x + (dx / d) * 10, e.z + (dz / d) * 10, def.speed, dt);
        if (e.t <= 0 && d > def.sight * 1.3) { e.state = 'idle'; e.t = 2; e.target = null; }
        break;
      }
    }
  }

  private enemyNet(): EnemyNet[] {
    const out: EnemyNet[] = [];
    const r = (v: number) => Math.round(v * 100) / 100;
    for (const e of this.enemies) out.push([e.id, ENEMY_TYPES.indexOf(e.type), r(e.x), r(e.y), r(e.z), r(e.ry), r(e.hp / ENEMY_DEF[e.type].hp), e.anim]);
    return out;
  }

  private spawnNear(type: EnemyType, cx: number, cz: number, r0: number, r1: number): Enemy | null {
    for (let k = 0; k < 24; k++) {
      const a = this.rng() * 6.283, r = r0 + this.rng() * (r1 - r0);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!this.walkable(x, z) || this.world.colliders.overlaps(x, z, 0.6, -50, 200)) continue;
      if (this.fires.some((f) => Math.hypot(f.x - x, f.z - z) < 14)) continue;
      return this.spawnEnemy(type, x, z, -1, 40);
    }
    return null;
  }

  // ---------------------------------------------------------------- tick
  private sendEnv() {
    this.emit(null, 'env', { time: this.time, day: this.day, weather: this.weather, dayLength: this.dayLength });
  }

  tick(dt: number) {
    if (this.players.size === 0) return;
    this.clock += dt;
    this.time += (dt * 24) / this.dayLength;
    if (this.time >= 24) { this.time -= 24; this.day++; }

    if (this.clock >= this.weatherUntil) {
      const r = this.rng();
      const next: WeatherType = this.weather !== 'clear' ? (r < 0.7 ? 'clear' : r < 0.85 ? 'rain' : 'fog')
        : r < 0.42 ? 'rain' : r < 0.72 ? 'fog' : 'storm';
      this.weather = next;
      this.weatherUntil = this.clock + (next === 'clear' ? 170 + this.rng() * 160 : 80 + this.rng() * 80);
      this.sendEnv();
    }

    for (const e of this.enemies) this.tickEnemy(e, dt);
    if (this.enemies.some((e) => e.state === 'dead' && e.t > 7)) this.enemies = this.enemies.filter((e) => !(e.state === 'dead' && e.t > 7));

    this.acc.respawn += dt;
    if (this.acc.respawn >= 2) {
      this.acc.respawn = 0;
      for (const [id, at] of this.depleted) {
        if (at > this.clock) continue;
        const n = this.world.nodes[id];
        if (this.nearestPlayer(n.x, n.z).d < 14) continue;
        this.depleted.delete(id);
        const col = this.world.nodeColliders.get(id);
        if (col) col.on = true;
        this.emit(null, 'node', { id, hp: nodeMaxHp(n), dep: 0 });
      }
      this.world.spawnZones.forEach((z, i) => {
        const alive = this.enemies.filter((e) => e.zone === i && e.state !== 'dead').length;
        if (alive < z.count && this.clock >= this.zoneRespawn[i] && this.nearestPlayer(z.x, z.z).d > z.r + 45) {
          this.spawnInZone(i);
          this.zoneRespawn[i] = this.clock + 60;
        }
      });
    }

    // night stalkers
    this.acc.stalker -= dt;
    if (this.acc.stalker <= 0) {
      this.acc.stalker = 26;
      if (this.isNight()) {
        const alive = this.enemies.filter((e) => e.type === 'stalker' && e.state !== 'dead').length;
        const living = [...this.players.values()].filter((p) => !p.dead);
        if (living.length && alive < Math.min(1 + living.length, 5)) {
          const t = living[Math.floor(this.rng() * living.length)];
          const e = this.spawnNear('stalker', t.x, t.z, 32, 46);
          if (e) { e.state = 'chase'; e.target = t.id; this.emit(null, 'egrowl', { id: e.id, type: 'stalker', x: e.x, z: e.z }); }
        }
      }
    }

    // radio transmission finale
    if (this.radio.state === 'tx') {
      const st = this.world.pois.find((q) => q.id === 'station')!;
      const near = [...this.players.values()].filter((p) => !p.dead && Math.hypot(p.x - st.x, p.z - st.z) < 38);
      if (near.length) {
        this.radio.progress = Math.min(1, this.radio.progress + dt / TX_DURATION);
        this.acc.wave -= dt;
        if (this.acc.wave <= 0) {
          this.acc.wave = 13;
          const alive = this.enemies.filter((e) => e.wave && e.state !== 'dead').length;
          for (let i = alive; i < Math.min(5, 2 + near.length); i++) {
            const e = this.spawnNear('mutant', st.x, st.z, 30, 40);
            if (e) { e.wave = true; e.state = 'chase'; e.target = near[Math.floor(this.rng() * near.length)].id; }
          }
        }
      }
      if (this.radio.progress >= 1) {
        this.radio.state = 'done';
        this.emit(null, 'radio', { radio: this.radio });
        this.emit(null, 'win', { day: this.day, time: this.time });
      }
    }

    this.acc.net += dt;
    if (this.acc.net >= 0.1) {
      this.acc.net = 0;
      this.emit(null, 'enemies', this.enemyNet());
      if (this.radio.state === 'tx') this.emit(null, 'radio', { radio: this.radio });
    }
    this.acc.players += dt;
    if (this.acc.players >= 0.066 && this.players.size > 1) {
      this.acc.players = 0;
      const arr: any[] = [];
      const r = (v: number) => Math.round(v * 100) / 100;
      for (const p of this.players.values()) arr.push([p.id, r(p.x), r(p.y), r(p.z), r(p.ry), p.anim, p.held, p.dead ? 1 : 0]);
      this.emit(null, 'players', arr);
    }
    this.acc.env += dt;
    if (this.acc.env >= 2) { this.acc.env = 0; this.sendEnv(); }
  }
}
