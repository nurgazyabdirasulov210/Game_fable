// The running game: rendering, player control, survival, interactions, building, networking glue.
import * as THREE from 'three';
import { angleDiff, clamp } from '../shared/rng';
import { BUILD_BY_TYPE, BUILDS, HAND_TOOL, ITEMS, RECIPES, type BuildType, type Cost, type ItemId, type Stack } from '../shared/items';
import {
  addBuildingPhysics, checkPlacement, ENEMY_DEF, ENEMY_TYPES, removeBuildingPhysics,
  type BuildingNet, type BuildPhysics, type EnemyNet, type PlayerNet, type RadioState, type WeatherType,
} from '../shared/room';
import { PLAY_RADIUS, toWorld, WORLD_HALF, World, type NodeDef, type Prop } from '../shared/world';
import type { AudioSys } from './audio';
import { Inventory } from './inventory';
import type { Transport } from './net';
import { QUESTS } from './quests';
import { writeSave, type PlayerSave } from './save';
import type { Settings } from './settings';
import { Buildings, FireFx, Particles, WeatherFx, type Emitter } from './render/buildings';
import { A_DEAD, A_IDLE, A_JUMP, A_RUN, A_SWIM, A_SWING, A_WALK, Creature, Humanoid, nameTag } from './render/character';
import { Sky } from './render/sky';
import { Structures } from './render/structures';
import { buildTerrain, renderMapImage, type TerrainView } from './render/terrain';
import { Vegetation } from './render/vegetation';
import { Hud, type Panel } from './ui/hud';
import { ITEM_ICON } from './ui/icons';

export interface GameOpts {
  mount: HTMLElement; transport: Transport; settings: Settings; audio: AudioSys;
  name: string; save: PlayerSave | null; onExit: (reason?: string) => void;
}

interface Remote { net: PlayerNet; model: Humanoid; tag: THREE.Sprite; tx: number; ty: number; tz: number; try_: number; anim: number }
type Target =
  | { kind: 'node'; node: NodeDef; d: number }
  | { kind: 'prop'; prop: Prop; d: number }
  | { kind: 'build'; b: BuildingNet; d: number }
  | { kind: 'water'; d: number };

const QUALITY = {
  low: { shadows: false, shadowSize: 1024, pr: 1, grass: 9000, lights: 3 },
  medium: { shadows: true, shadowSize: 2048, pr: 1.5, grass: 26000, lights: 4 },
  high: { shadows: true, shadowSize: 4096, pr: 2, grass: 44000, lights: 6 },
};
const WALK = 4.4, RUN = 7.6, SWIM = 2.8, GRAV = 22, JUMP = 7.4, RADIUS = 0.38;
const PICK_LABEL: Record<string, string> = { stone: 'Подобрать камень', stick: 'Подобрать ветки', fiber: 'Собрать волокна', berry: 'Собрать ягоды', crate: 'Открыть контейнер' };
const PART_NAMES = { battery: 'Аккумулятор', cable: 'Антенный кабель', tube: 'Радиолампа' } as const;

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.15, 1500);
  world: World;
  private terrain: TerrainView;
  private sky: Sky;
  private veg: Vegetation;
  private structs: Structures;
  private builds: Buildings;
  private fire: FireFx;
  private weatherFx: WeatherFx;
  private particles: Particles;
  private me: Humanoid;
  hud: Hud;
  inv = new Inventory();

  // player state
  pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  yaw = 0; pitch = 0.32;
  private camDist = 5.6; private camCur = 5.6;
  private facing = 0;
  private onGround = true;
  private swimming = false;
  stats = { hp: 100, hunger: 100, thirst: 100, stamina: 100 };
  dead = false;
  private staminaDelay = 0;
  private swingCd = 0; private hitTimer = -1; private useCd = 0;
  private lastHurtBy = '';
  private camTarget = new THREE.Vector3();

  // world state mirrored from the room
  readonly myId: string;
  private remotes = new Map<string, Remote>();
  private creatures = new Map<number, Creature>();
  buildings = new Map<number, BuildingNet>();
  private phys = new Map<number, BuildPhysics>();
  time = 8; day = 1; weather: WeatherType = 'clear'; private dayLength = 720;
  radio: RadioState;
  private openChestId: number | null = null;

  // progression
  quest = 0;
  counters: Record<string, number> = {};
  discovered = new Set<string>();
  private tally = { kills: 0, crafted: 0, built: 0, deaths: 0, playtime: 0 };
  private won = false;
  private zoneId: string | null = null;

  // input / modes
  private keys = new Set<string>();
  private locked = false;
  private dragging = false;
  private build: { type: BuildType; rot: number; dist: number; x: number; y: number; z: number; ok: boolean; yHint?: number; reason?: string } | null = null;
  private pending = new Map<number, Cost>();
  private reqId = 1;
  private target: Target | null = null;

  private running = true;
  private raf = 0;
  private last = performance.now();
  private clock = 0;
  private acc = { net: 0, ui: 0, save: 0, quest: 0, fps: 0, frames: 0 };
  private canvas: HTMLCanvasElement;
  private mapImg: HTMLCanvasElement;
  private tmpNodes: NodeDef[] = [];
  private emitters: Emitter[] = [];
  private emitterPool: Emitter[] = [];
  private disposers: (() => void)[] = [];
  private v3 = new THREE.Vector3();
  private exited = false;
  private pauseAt = -1e9;
  private lockAt = -1e9;
  firstFrame = false;
  /** test hook: when true the frame loop idles and the simulation is driven through step() */
  manual = false;

  constructor(private o: GameOpts) {
    const t0 = performance.now();
    const boot = (l: string) => console.info(`[boot] ${l} +${Math.round(performance.now() - t0)}ms`);
    const snap = o.transport.snapshot;
    this.myId = snap.you;
    const q = QUALITY[o.settings.quality];
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    o.mount.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.world = new World(snap.seed);
    boot('world');
    const floatLinear = this.renderer.extensions.has('OES_texture_float_linear');
    this.terrain = buildTerrain(this.world, this.scene, floatLinear);
    boot('terrain');
    this.sky = new Sky(this.scene, q.shadows, q.shadowSize);
    this.veg = new Vegetation(this.world, this.scene, this.terrain.heightTex, q.grass);
    boot('vegetation');
    this.structs = new Structures(this.world, this.scene);
    boot('structures');
    this.builds = new Buildings(this.scene);
    this.fire = new FireFx(this.scene, q.lights);
    this.weatherFx = new WeatherFx(this.scene);
    this.weatherFx.onThunder = (d) => o.audio.thunder(d);
    this.particles = new Particles(this.scene);
    this.mapImg = renderMapImage(this.world);
    boot('map');

    const mine = snap.players.find((p) => p.id === this.myId)!;
    this.me = new Humanoid(mine.color);
    this.me.onStep = () => { if (this.onGround && !this.dead) o.audio.step(this.surface(), this.keys.has('ShiftLeft')); };
    this.scene.add(this.me.root);
    this.pos.set(mine.x, mine.y, mine.z);

    this.hud = new Hud(o.mount, this.inv, o.settings, {
      craft: (id) => this.craft(id), useSlot: (i) => this.useItemAt(i),
      selectBuild: (t) => this.enterBuild(t),
      chestPut: (i) => this.chestPut(i), chestTake: (s) => { if (this.openChestId !== null) this.send('chestTake', { id: this.openChestId, slot: s }); },
      resume: () => {}, save: () => { if (this.saveGame()) this.hud.toast('Игра сохранена', 'good'); },
      exitToMenu: () => this.exit(), respawn: () => this.respawn(),
      settingsChanged: () => { o.audio.setVolumes(o.settings.master, o.settings.music); this.onSettings?.(); },
      chat: (t) => this.send('chat', { text: t }),
      panelChanged: (p) => this.onPanel(p),
      sfx: (k) => (k === 'ui' ? o.audio.ui() : o.audio.uiHover()),
    });
    this.hud.setMapRenderer((cv, full) => this.drawMap(cv, full));
    this.inv.onChange = () => { this.hud.renderHotbar(); this.syncHeld(); };

    // apply snapshot
    this.time = snap.time; this.day = snap.day; this.weather = snap.weather; this.radio = snap.radio;
    for (const [id, , dep] of snap.nodes) if (dep) this.applyNode(id, true);
    for (const b of snap.buildings) this.addBuilding(b);
    for (const p of snap.players) if (p.id !== this.myId) this.addRemote(p);
    this.onEnemies(snap.enemies);

    if (o.save) this.loadPlayer(o.save);
    else { this.inv.add('berries', 4); this.inv.add('water', 2); this.inv.selected = 2; }
    this.facing = this.yaw;
    this.camTarget.copy(this.pos).setY(this.pos.y + 1.55);
    this.syncHeld();
    this.hud.renderHotbar();
    this.updateQuestHud();
    this.updatePlayersHud();

    boot('hud');
    o.transport.onMessage((t, d) => { try { this.onNet(t, d); } catch (e) { console.error('net handler', t, e); } });
    o.transport.onDisconnect(() => { if (!this.exited) this.exit('Соединение с сервером потеряно'); });
    this.bindInput();
    this.resize();
    o.audio.ambienceOn(true);
    (window as any).__game = this;
    if (!o.save) setTimeout(() => this.hud.banner('ЭМБЕРФИЛД', 'Вы очнулись в лагере выживших. Осмотритесь и соберите припасы.', 'info'), 600);
    this.raf = requestAnimationFrame(this.frame);
  }
  onSettings: (() => void) | null = null;

  // ================================================================ persistence
  private loadPlayer(s: PlayerSave) {
    this.pos.set(s.x, s.y, s.z); this.yaw = s.yaw;
    this.stats = { hp: s.hp, hunger: s.hunger, thirst: s.thirst, stamina: s.stamina };
    this.inv.slots = s.slots.map((x) => (x ? [x[0], x[1]] as Stack : null));
    this.inv.selected = s.selected;
    this.quest = s.quest; this.counters = { ...s.counters }; this.discovered = new Set(s.discovered);
    this.tally = { ...s.stats }; this.won = s.won;
  }

  saveGame(): boolean {
    const room = this.o.transport.serialize();
    if (!room) return false;
    return writeSave({
      v: 1, name: this.o.name, savedAt: Date.now(), room,
      player: {
        x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw,
        hp: this.dead ? 60 : this.stats.hp, hunger: this.stats.hunger, thirst: this.stats.thirst, stamina: this.stats.stamina,
        slots: this.inv.slots, selected: this.inv.selected, quest: this.quest, counters: this.counters,
        discovered: [...this.discovered], stats: this.tally, won: this.won,
      },
    });
  }

  exit(reason?: string) {
    if (this.exited) return;
    this.exited = true;
    this.saveGame();
    this.dispose();
    this.o.onExit(reason);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
    if (document.pointerLockElement) document.exitPointerLock();
    this.o.transport.close();
    this.o.audio.ambienceOn(false);
    this.hud.destroy();
    this.scene.traverse((ob) => {
      const m = ob as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    this.terrain.heightTex.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    if ((window as any).__game === this) (window as any).__game = null;
  }

  // ================================================================ input
  private bindInput() {
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, f: (e: any) => void, opt?: AddEventListenerOptions) => {
      t.addEventListener(type, f, opt); this.disposers.push(() => t.removeEventListener(type, f, opt));
    };
    on(window, 'resize', () => this.resize());
    on(window, 'blur', () => this.keys.clear());
    on(window, 'beforeunload', () => { if (!this.exited) this.saveGame(); });
    on(document, 'pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      this.lockAt = performance.now();
      if (was && !this.locked && !this.hud.panel && this.running) { this.openPause(); this.pauseAt = performance.now(); }
    });
    on(this.canvas, 'mousedown', (e: MouseEvent) => {
      this.o.audio.init();
      if (this.hud.panel) return;
      if (!this.locked) { this.lock(); this.dragging = true; if (e.button !== 0) return; }
      if (e.button === 0) this.primary();
      else if (e.button === 2 && this.build) this.exitBuild();
    });
    on(window, 'mouseup', () => (this.dragging = false));
    on(this.canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(document, 'mousemove', (e: MouseEvent) => {
      if (this.hud.panel || (!this.locked && !this.dragging)) return;
      // browsers may report one huge bogus delta right after pointer lock engages
      if (performance.now() - this.lockAt < 150 || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      const s = 0.0023 * this.o.settings.sens;
      this.yaw -= e.movementX * s;
      this.pitch = clamp(this.pitch + e.movementY * s * (this.o.settings.invertY ? -1 : 1), -0.45, 1.35);
    });
    on(this.canvas, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      if (this.build) this.build.dist = clamp(this.build.dist - Math.sign(e.deltaY) * 0.5, 2.5, 8);
      else this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 0.6, 2.6, 10);
    }, { passive: false });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
  }

  private lock() {
    try { const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* pointer lock unavailable */ }
  }

  private onPanel(p: Panel) {
    this.keys.clear();
    if (p && p !== 'chat') { if (document.pointerLockElement) document.exitPointerLock(); }
    else if (!p && this.running) this.lock();
    if (p !== 'chest') this.openChestId = null;
    if (p) this.hud.setPrompt(null);
  }

  private openPause() {
    const code = this.o.transport.solo ? null : this.o.transport.snapshot.code;
    this.hud.openPause({ solo: this.o.transport.solo, code, link: code ? `${location.origin}${location.pathname}?room=${code}` : null });
  }

  private onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const c = e.code;
    if (c === 'Tab') { e.preventDefault(); if (this.hud.panel === 'inv') this.hud.close(); else if (!this.hud.panel || this.hud.panel === 'build' || this.hud.panel === 'map') { this.o.audio.ui(); this.exitBuild(); this.hud.openInventory(); } return; }
    if (c === 'Escape') {
      if (performance.now() - this.pauseAt < 300) return;
      if (this.hud.panel === 'settings') this.openPause();
      else if (this.hud.panel) this.hud.close();
      else if (this.build) this.exitBuild();
      else this.openPause();
      return;
    }
    if (this.hud.panel === 'build' && /^Digit[1-5]$/.test(c)) { const b = BUILDS[Number(c[5]) - 1]; if (!b.needsHammer || this.inv.count('hammer')) { this.hud.forceClose(); this.enterBuild(b.type); } return; }
    if (c === 'KeyB' && !e.repeat) { if (this.hud.panel === 'build') this.hud.close(); else if (!this.hud.panel || this.hud.panel === 'inv') { this.o.audio.ui(); this.exitBuild(); this.hud.openBuild(this.inv.count('hammer') > 0); } return; }
    if (c === 'KeyM' && !e.repeat) { if (this.hud.panel === 'map') this.hud.close(); else if (!this.hud.panel) { this.o.audio.ui(); this.hud.openMap(); } return; }
    if (this.hud.panel) return;
    if (c === 'Enter') { this.hud.openChat(); return; }
    this.keys.add(c);
    if (e.repeat || this.dead) return;
    if (/^Digit[1-6]$/.test(c)) { this.inv.selected = Number(c[5]) - 1; this.inv.onChange(); this.o.audio.uiHover(); }
    else if (c === 'KeyE') this.interact();
    else if (c === 'KeyF') this.fillWater();
    else if (c === 'KeyR' && this.build) this.build.rot += Math.PI / 8;
    else if (c === 'KeyX') this.demolish();
    else if (c === 'Space') e.preventDefault();
  }

  private send(type: string, data: any) { this.o.transport.send(type, data); }

  // ================================================================ items / crafting
  private syncHeld() {
    const h = this.inv.held;
    this.me.setHeld(h && ITEMS[h].kind === 'tool' ? h : null);
  }

  craft(id: ItemId) {
    const r = RECIPES.find((x) => x.id === id);
    if (!r || !this.inv.has(r.cost)) { this.o.audio.error(); return; }
    this.inv.pay(r.cost);
    const left = this.inv.add(r.id, r.count);
    if (left > 0) { this.inv.refund(r.cost); this.hud.toast('Инвентарь полон', 'bad'); this.o.audio.error(); return; }
    this.counters['craft_' + id] = (this.counters['craft_' + id] ?? 0) + 1;
    this.tally.crafted++;
    this.o.audio.craft();
    this.hud.toast(`Создано: ${ITEMS[id].name}`, 'good', ITEM_ICON[id]);
  }

  useItemAt(i: number) {
    const s = this.inv.slots[i];
    if (!s || this.dead) return;
    const def = ITEMS[s[0]];
    if (def.kind !== 'food' || !def.food) { if (i < 6) { this.inv.selected = i; this.inv.onChange(); } return; }
    if (this.useCd > 0) return;
    this.useCd = 0.45;
    const f = def.food;
    if (f.hunger) this.stats.hunger = clamp(this.stats.hunger + f.hunger, 0, 100);
    if (f.thirst) this.stats.thirst = clamp(this.stats.thirst + f.thirst, 0, 100);
    if (f.health) this.stats.hp = clamp(this.stats.hp + f.health, 1, 100);
    this.inv.removeAt(i, 1);
    if (def.id === 'water') this.o.audio.drink(); else if (def.id === 'bandage') this.o.audio.rustle(); else this.o.audio.eat();
    this.hud.toast(`${def.name}: ${[f.hunger ? `сытость +${f.hunger}` : '', f.thirst ? `вода +${f.thirst}` : '', f.health ? `здоровье ${f.health > 0 ? '+' : ''}${f.health}` : ''].filter(Boolean).join(', ')}`, 'info', ITEM_ICON[def.id]);
  }

  private giveLoot(items: Stack[], src: string) {
    const got: Stack[] = [];
    let lost = false;
    for (const [id, n] of items) {
      const left = this.inv.add(id, n);
      if (n - left > 0) got.push([id, n - left]);
      if (left > 0) lost = true;
      if (['tree', 'rock', 'stone', 'stick', 'fiber', 'berry', 'crate'].includes(src)) this.counters[id] = (this.counters[id] ?? 0) + (n - left);
    }
    if (got.length) this.hud.lootToast(got);
    if (lost) { this.hud.toast('Инвентарь полон — часть добычи потеряна', 'bad'); this.o.audio.error(); }
  }

  private chestPut(slot: number) {
    if (this.openChestId === null) return;
    const s = this.inv.slots[slot]; if (!s) return;
    const [id, n] = s;
    this.inv.removeAt(slot, n);
    this.send('chestPut', { id: this.openChestId, item: id, n });
  }

  // ================================================================ actions
  private surface(): 'grass' | 'wood' | 'water' {
    const th = this.world.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y > th + 0.1) return 'wood';
    return th < 0.05 ? 'water' : 'grass';
  }

  private primary() {
    if (this.dead) return;
    if (this.build) { this.placeBuild(); return; }
    const held = this.inv.held;
    if (held && ITEMS[held].kind === 'food') { this.useItemAt(this.inv.selected); return; }
    if (this.swingCd > 0 || this.swimming) return;
    if (this.stats.stamina < 3) { this.o.audio.error(); return; }
    this.stats.stamina -= 3.5; this.staminaDelay = 0.5;
    this.swingCd = 0.5; this.hitTimer = 0.2;
    this.facing = this.yaw;
    this.me.swing();
    this.o.audio.swing();
  }

  private resolveHit() {
    const held = this.inv.held;
    const tool = (held && ITEMS[held].tool) || HAND_TOOL;
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    // enemies first
    let best: Creature | null = null, bestId = -1, bd = Infinity;
    for (const [id, c] of this.creatures) {
      if (c.anim === 4) continue;
      const dx = c.root.position.x - this.pos.x, dz = c.root.position.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > tool.reach + 0.7 || Math.abs(c.root.position.y - this.pos.y) > 2.5) continue;
      if (d > 0.8 && (dx * fx + dz * fz) / d < 0.35) continue;
      if (d < bd) { bd = d; best = c; bestId = id; }
    }
    if (best) { this.send('attack', { id: bestId, item: held }); return; }
    let node: NodeDef | null = null; bd = Infinity;
    for (const n of this.world.nodesNear(this.pos.x, this.pos.z, tool.reach + 2.5, this.tmpNodes)) {
      if ((n.kind !== 'tree' && n.kind !== 'rock') || this.veg.depleted.has(n.id)) continue;
      const dx = n.x - this.pos.x, dz = n.z - this.pos.z;
      const d = Math.hypot(dx, dz) - (n.kind === 'rock' ? 0.85 * n.scale : 0.45 * n.scale);
      if (d > tool.reach - 0.6 || (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1) < 0.3) continue;
      if (d < bd) { bd = d; node = n; }
    }
    if (!node) return;
    this.send('hit', { id: node.id, item: held });
    this.veg.shake(node.id);
    const py = this.pos.y + 1.1, k = 0.75;
    const hx = this.pos.x + (node.x - this.pos.x) * k, hz = this.pos.z + (node.z - this.pos.z) * k;
    if (node.kind === 'tree') { this.o.audio.chop(); this.particles.burst(hx, py, hz, 0xc9955c, 9); }
    else { this.o.audio.stone(); this.particles.burst(hx, py - 0.3, hz, 0x9a99ad, 9); }
  }

  private findTarget(): Target | null {
    const p = this.pos;
    let best: Target | null = null;
    const consider = (t: Target) => { if (!best || t.d < best.d) best = t; };
    for (const n of this.world.nodesNear(p.x, p.z, 2.7, this.tmpNodes)) {
      if (n.kind === 'tree' || n.kind === 'rock' || this.veg.depleted.has(n.id) || Math.abs(n.y - p.y) > 2) continue;
      consider({ kind: 'node', node: n, d: Math.hypot(n.x - p.x, n.z - p.z) });
    }
    for (const pr of this.world.props) {
      if (!pr.use) continue;
      const d = Math.hypot(pr.x - p.x, pr.z - p.z);
      if (d > (pr.use === 'ladder' ? 2.4 : 3.1)) continue;
      if (pr.use !== 'ladder' && Math.abs(pr.y - p.y) > 2) continue;
      consider({ kind: 'prop', prop: pr, d: d - 0.6 });
    }
    for (const b of this.buildings.values()) {
      if (b.type !== 'door' && b.type !== 'chest' && b.type !== 'campfire') continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d > 2.7 || Math.abs(b.y - p.y) > 2.2) continue;
      consider({ kind: 'build', b, d: d - 0.3 });
    }
    if (!best) {
      const ax = p.x + Math.sin(this.facing) * 1.5, az = p.z + Math.cos(this.facing) * 1.5;
      if ((this.world.heightAt(ax, az) < -0.12 || this.world.heightAt(p.x, p.z) < -0.05) && p.y < 0.8) best = { kind: 'water', d: 0 };
    }
    return best;
  }

  private promptFor(t: Target | null): string | null {
    if (!t) return null;
    const E = '<kbd>E</kbd> ';
    if (t.kind === 'node') return E + PICK_LABEL[t.node.kind];
    if (t.kind === 'water') return `${E}Пить &nbsp; <kbd>F</kbd> Набрать воду`;
    if (t.kind === 'build') {
      if (t.b.type === 'door') return E + (t.b.open ? 'Закрыть дверь' : 'Открыть дверь');
      if (t.b.type === 'chest') return E + 'Открыть ящик';
      return this.inv.count('raw_meat') ? E + 'Пожарить мясо' : 'Костёр — тепло восстанавливает здоровье';
    }
    const u = t.prop.use;
    if (u === 'firepit') return this.inv.count('raw_meat') ? E + 'Пожарить мясо' : 'Костёр лагеря — тепло восстанавливает здоровье';
    if (u === 'ladder') return E + (this.pos.y > (t.prop.top ?? 0) - 1.5 ? 'Спуститься' : 'Подняться на башню');
    if (u === 'radio') {
      const r = this.radio;
      if (r.state === 'broken') {
        const have = (Object.keys(PART_NAMES) as (keyof typeof PART_NAMES)[]).filter((k) => !r.parts[k] && this.inv.count(k));
        if (have.length) return E + 'Установить: ' + have.map((k) => PART_NAMES[k]).join(', ');
        const need = (Object.keys(PART_NAMES) as (keyof typeof PART_NAMES)[]).filter((k) => !r.parts[k]).map((k) => PART_NAMES[k]);
        return 'Радиостанция неисправна. Не хватает: ' + need.join(', ');
      }
      if (r.state === 'ready') return E + 'Включить передатчик';
      if (r.state === 'tx') return 'Идёт передача сигнала…';
      return 'Сигнал отправлен. Помощь в пути.';
    }
    return null;
  }

  private cook() {
    const n = this.inv.count('raw_meat');
    if (!n) { this.hud.toast('Нет сырого мяса для жарки', 'info'); return; }
    this.inv.remove('raw_meat', n);
    this.inv.add('cooked_meat', n);
    this.o.audio.craft();
    this.hud.toast(`Пожарено мяса: ${n}`, 'good', ITEM_ICON.cooked_meat);
  }

  private interact() {
    const t = this.target ?? this.findTarget();
    if (!t) return;
    if (t.kind === 'node') { this.send('pick', { id: t.node.id }); return; }
    if (t.kind === 'water') {
      if (this.useCd > 0) return;
      this.useCd = 0.6;
      this.stats.thirst = clamp(this.stats.thirst + 30, 0, 100);
      this.o.audio.drink();
      return;
    }
    if (t.kind === 'build') {
      if (t.b.type === 'door') this.send('door', { id: t.b.id });
      else if (t.b.type === 'chest') { this.openChestId = t.b.id; const id = t.b.id; this.o.audio.crate(); this.hud.openChest(t.b.items ?? []); this.openChestId = id; }
      else this.cook();
      return;
    }
    const pr = t.prop;
    if (pr.use === 'firepit') this.cook();
    else if (pr.use === 'ladder') {
      const top = pr.top ?? 0, c = Math.cos(pr.rot), s = Math.sin(pr.rot);
      const up = this.pos.y < top - 1.5;
      const [ox, oz] = toWorld(0, up ? -1.4 : 0.9, c, s);
      this.pos.set(pr.x + ox, up ? top + 0.02 : this.world.heightAt(pr.x + ox, pr.z + oz), pr.z + oz);
      this.vel.set(0, 0, 0);
      this.o.audio.step('wood', false); this.o.audio.step('wood', true);
    } else if (pr.use === 'radio') {
      const r = this.radio;
      if (r.state === 'broken') {
        let any = false;
        for (const k of Object.keys(PART_NAMES) as (keyof typeof PART_NAMES)[]) {
          if (!r.parts[k] && this.inv.count(k)) { this.inv.remove(k, 1); this.send('radio', { action: 'install', part: k }); any = true; }
        }
        if (!any) { this.o.audio.error(); this.hud.toast('Нужны детали: аккумулятор, антенный кабель, радиолампа', 'bad'); }
      } else if (r.state === 'ready') this.send('radio', { action: 'activate' });
    }
  }

  private fillWater() {
    const t = this.target;
    if (!t || t.kind !== 'water' || this.useCd > 0) return;
    this.useCd = 0.6;
    if (this.inv.add('water', 1) > 0) { this.hud.toast('Нет места для воды', 'bad'); this.o.audio.error(); return; }
    this.o.audio.drink();
    this.hud.lootToast([['water', 1]]);
  }

  // ================================================================ building
  private enterBuild(type: BuildType) {
    const def = BUILD_BY_TYPE[type];
    if (def.needsHammer && !this.inv.count('hammer')) { this.hud.toast('Нужен строительный молоток', 'bad'); this.o.audio.error(); return; }
    this.build = { type, rot: this.build?.rot ?? Math.round(this.yaw / (Math.PI / 8)) * (Math.PI / 8), dist: 4.5, x: 0, y: 0, z: 0, ok: false };
  }
  private exitBuild() { if (!this.build) return; this.build = null; this.builds.setGhost(null); this.hud.setBuildHint(null); }

  private updateBuild() {
    const b = this.build; if (!b) return;
    const def = BUILD_BY_TYPE[b.type];
    let x = this.pos.x + Math.sin(this.yaw) * b.dist, z = this.pos.z + Math.cos(this.yaw) * b.dist, rot = b.rot;
    b.yHint = undefined;
    if (b.type === 'foundation' || b.type === 'wall' || b.type === 'door') {
      let bestD = b.type === 'foundation' ? 3.2 : 2.6, snap: { x: number; z: number; rot: number; y: number } | null = null;
      for (const f of this.buildings.values()) {
        if (f.type !== 'foundation' || Math.hypot(f.x - x, f.z - z) > 8) continue;
        const c = Math.cos(f.rot), s = Math.sin(f.rot), k = b.type === 'foundation' ? 4 : 2;
        for (const [lx, lz, r] of [[k, 0, Math.PI / 2], [-k, 0, Math.PI / 2], [0, k, 0], [0, -k, 0]]) {
          const [wx, wz] = toWorld(lx, lz, c, s);
          const d = Math.hypot(f.x + wx - x, f.z + wz - z);
          if (d < bestD) { bestD = d; snap = { x: f.x + wx, z: f.z + wz, rot: b.type === 'foundation' ? f.rot : f.rot + r, y: f.y }; }
        }
      }
      if (snap) { x = snap.x; z = snap.z; rot = snap.rot; if (b.type === 'foundation') b.yHint = snap.y; }
    }
    const pl = checkPlacement(this.world, this.buildings.values(), b.type, x, z, rot, this.pos.y, b.yHint);
    let ok = pl.ok, reason = pl.reason;
    if (ok && !this.inv.has(def.cost)) { ok = false; reason = 'Не хватает ресурсов'; }
    if (ok && Math.hypot(x - this.pos.x, z - this.pos.z) < (b.type === 'foundation' ? 0 : 0.5)) { ok = false; reason = 'Слишком близко'; }
    b.x = x; b.z = z; b.y = pl.y; b.ok = ok; b.reason = reason;
    this.builds.setGhost(b.type, x, pl.y, z, rot, ok);
    (b as any).finalRot = rot;
    this.hud.setBuildHint(`<b>${def.name}</b> ${ok ? '' : `<span class="bad">— ${reason}</span>`} &nbsp; <kbd>ЛКМ</kbd> поставить · <kbd>R</kbd> повернуть · <kbd>ПКМ</kbd> отмена`);
  }

  private placeBuild() {
    const b = this.build; if (!b) return;
    if (!b.ok) { this.o.audio.error(); if (b.reason) this.hud.toast(b.reason, 'bad'); return; }
    const def = BUILD_BY_TYPE[b.type];
    if (!this.inv.pay(def.cost)) return;
    const req = this.reqId++;
    this.pending.set(req, def.cost);
    this.send('build', { type: b.type, x: b.x, z: b.z, rot: (b as any).finalRot ?? b.rot, y: b.yHint, req });
  }

  private demolish() {
    if (!this.inv.count('hammer')) { this.hud.toast('Для разборки нужен строительный молоток', 'bad'); return; }
    const ax = this.pos.x + Math.sin(this.facing) * 1.8, az = this.pos.z + Math.cos(this.facing) * 1.8;
    let best: BuildingNet | null = null, bd = 3.2;
    for (const b of this.buildings.values()) {
      const d = Math.hypot(b.x - ax, b.z - az) - (b.type === 'foundation' ? 1.4 : 0) + (b.type === 'foundation' ? 1.2 : 0);
      if (d < bd && Math.abs(b.y - this.pos.y) < 3.5) { bd = d; best = b; }
    }
    if (best) this.send('demolish', { id: best.id }); else this.hud.toast('Рядом нет построек', 'info');
  }

  private addBuilding(b: BuildingNet) {
    this.buildings.set(b.id, b);
    this.phys.set(b.id, addBuildingPhysics(this.world, b));
    this.builds.add(b);
  }

  // ================================================================ networking
  private addRemote(p: PlayerNet) {
    if (this.remotes.has(p.id)) return;
    const model = new Humanoid(p.color, 0x6b7a4a);
    const tag = nameTag(p.name, p.color);
    model.root.add(tag);
    model.root.position.set(p.x, p.y, p.z);
    this.scene.add(model.root);
    this.remotes.set(p.id, { net: p, model, tag, tx: p.x, ty: p.y, tz: p.z, try_: p.ry, anim: 0 });
  }

  private applyNode(id: number, dep: boolean) {
    this.veg.setDepleted(id, dep);
    const col = this.world.nodeColliders.get(id);
    if (col && this.world.nodes[id].kind !== 'crate') col.on = !dep;
  }

  private onEnemies(list: EnemyNet[]) {
    const stamp = performance.now();
    for (const [id, ti, x, y, z, ry, hp, anim] of list) {
      let c = this.creatures.get(id);
      if (!c) {
        c = new Creature(ENEMY_TYPES[ti]);
        c.root.position.set(x, y, z); c.root.rotation.y = ry;
        this.scene.add(c.root);
        this.creatures.set(id, c);
      }
      c.tx = x; c.ty = y; c.tz = z; c.try_ = ry; c.hp = hp; c.anim = anim; c.seen = stamp;
    }
    for (const [id, c] of this.creatures) if (c.seen !== stamp) { this.scene.remove(c.root); c.dispose(); this.creatures.delete(id); }
  }

  private distVol(x: number, z: number, range: number) { return clamp(1 - Math.hypot(x - this.pos.x, z - this.pos.z) / range, 0, 1); }

  private onNet(type: string, d: any) {
    const a = this.o.audio;
    switch (type) {
      case 'players':
        for (const [id, x, y, z, ry, anim, held, dead] of d as any[]) {
          const r = this.remotes.get(id); if (!r) continue;
          r.tx = x; r.ty = y; r.tz = z; r.try_ = ry;
          if ((anim & A_SWING) && !(r.anim & A_SWING)) r.model.swing();
          r.anim = anim; r.net.dead = !!dead;
          r.model.setHeld(held && ITEMS[held as ItemId]?.kind === 'tool' ? held : null);
        }
        break;
      case 'enemies': this.onEnemies(d); break;
      case 'env': this.time = d.time; this.day = d.day; this.weather = d.weather; this.dayLength = d.dayLength ?? 720; break;
      case 'joined': if (d.id !== this.myId) { this.addRemote(d); this.hud.toast(`${d.name} присоединился к игре`, 'good'); a.quest(); this.updatePlayersHud(); } break;
      case 'left': {
        const r = this.remotes.get(d.id);
        if (r) { this.scene.remove(r.model.root); r.model.dispose(); this.remotes.delete(d.id); this.hud.toast(`${r.net.name} покинул игру`, 'info'); this.updatePlayersHud(); }
        break;
      }
      case 'node': {
        const n = this.world.nodes[d.id]; if (!n) break;
        const wasDep = this.veg.depleted.has(d.id);
        this.applyNode(d.id, !!d.dep);
        const vol = this.distVol(n.x, n.z, 40);
        if (d.dep && !wasDep) {
          if (n.kind === 'tree') { if (vol > 0) a.treeFall(); this.particles.burst(n.x, n.y + 2, n.z, 0x3f8f5c, 22, 5); }
          else if (n.kind === 'rock') this.particles.burst(n.x, n.y + 0.6, n.z, 0x8a8998, 18, 4);
          else if (d.by === this.myId) { if (n.kind === 'crate') a.crate(); else if (n.kind === 'fiber' || n.kind === 'berry') a.rustle(); else a.pickup(); }
        } else if (!d.dep && d.by && d.by !== this.myId) { this.veg.shake(d.id); if (vol > 0.2) (n.kind === 'tree' ? a.chop() : a.stone()); }
        break;
      }
      case 'loot': {
        this.giveLoot(d.items, d.src);
        if (d.src === 'kill') { this.tally.kills++; this.hud.toast(`Повержен: ${ENEMY_DEF[d.enemy as keyof typeof ENEMY_DEF]?.name ?? 'враг'}`, 'good'); }
        break;
      }
      case 'built': {
        this.addBuilding(d.b);
        this.particles.burst(d.b.x, d.b.y + 0.5, d.b.z, 0xc9955c, 14, 3);
        if (this.distVol(d.b.x, d.b.z, 40) > 0) a.build();
        if (d.by === this.myId) {
          this.pending.delete(d.req);
          this.counters['build_' + d.b.type] = (this.counters['build_' + d.b.type] ?? 0) + 1;
          this.tally.built++;
          if (this.build && !this.inv.has(BUILD_BY_TYPE[this.build.type].cost)) { this.hud.toast('Ресурсы закончились', 'info'); this.exitBuild(); }
        }
        break;
      }
      case 'buildFail': {
        const cost = this.pending.get(d.req);
        if (cost) { this.inv.refund(cost); this.pending.delete(d.req); }
        this.hud.toast(d.reason ?? 'Нельзя построить здесь', 'bad'); a.error();
        break;
      }
      case 'removed': {
        const ph = this.phys.get(d.id);
        if (ph) removeBuildingPhysics(this.world, ph);
        this.phys.delete(d.id); this.buildings.delete(d.id); this.builds.remove(d.id);
        if (this.openChestId === d.id) this.hud.forceClose();
        a.build();
        break;
      }
      case 'door': {
        const b = this.buildings.get(d.id); if (!b) break;
        b.open = d.open;
        const ph = this.phys.get(d.id); if (ph?.door) ph.door.on = !d.open;
        if (this.distVol(b.x, b.z, 25) > 0) a.door();
        break;
      }
      case 'chest': {
        const b = this.buildings.get(d.id); if (!b) break;
        b.items = d.items;
        if (this.openChestId === d.id) this.hud.updateChest(d.items);
        break;
      }
      case 'radio': {
        const prev = this.radio.state;
        this.radio = d.radio;
        if (d.part) { a.craft(); this.hud.toast(`Установлено: ${PART_NAMES[d.part as keyof typeof PART_NAMES]}`, 'good', ITEM_ICON[d.part as ItemId]); }
        if (prev !== 'ready' && d.radio.state === 'ready') { a.radio(); this.hud.banner('РАДИОСТАНЦИЯ ИСПРАВНА', 'Включите передатчик, когда будете готовы к обороне', 'quest'); }
        if (prev !== 'tx' && d.radio.state === 'tx') { a.radio(); this.hud.banner('ПЕРЕДАЧА НАЧАЛАСЬ', 'Шум привлёк мутантов. Удерживайте станцию!', 'danger'); }
        break;
      }
      case 'hurt': {
        if (this.dead) break;
        this.stats.hp -= d.dmg;
        this.lastHurtBy = ENEMY_DEF[d.by as keyof typeof ENEMY_DEF]?.name ?? '';
        this.hud.flashDamage(); a.hurt();
        const dx = this.pos.x - d.x, dz = this.pos.z - d.z, l = Math.hypot(dx, dz) || 1;
        this.vel.x += (dx / l) * 5; this.vel.z += (dz / l) * 5;
        break;
      }
      case 'ehit': {
        const c = this.creatures.get(d.id);
        if (c) c.hit();
        if (d.by) { this.particles.burst(d.x, d.y + 1, d.z, 0xb0303a, 8, 3); if (this.distVol(d.x, d.z, 30) > 0) a.hitEnemy(); }
        break;
      }
      case 'egrowl': a.growl(d.type, this.distVol(d.x, d.z, d.type === 'stalker' ? 70 : 40)); if (d.type === 'stalker' && this.distVol(d.x, d.z, 70) > 0) this.hud.setDanger('Ночной охотник рядом. Держитесь у огня!'); break;
      case 'chat': this.hud.chatLine(d.name, d.color, d.text); a.uiHover(); break;
      case 'win': this.onWin(); break;
    }
  }

  private onWin() {
    if (this.won) return;
    this.won = true;
    this.o.audio.win();
    const mins = Math.floor(this.tally.playtime / 60);
    const row = (k: string, v: string | number) => `<div><span>${k}</span><b>${v}</b></div>`;
    this.checkQuests(true);
    this.hud.showWin(row('Прожито дней', this.day) + row('Время в игре', `${mins} мин`) + row('Повержено врагов', this.tally.kills) + row('Создано предметов', this.tally.crafted) + row('Построено объектов', this.tally.built) + row('Смертей', this.tally.deaths));
    this.saveGame();
  }

  // ================================================================ quests / HUD helpers
  private questCtx() { return { counters: this.counters, discovered: this.discovered, radio: this.radio }; }

  private checkQuests(silent = false) {
    let changed = false;
    while (this.quest < QUESTS.length) {
      const q = QUESTS[this.quest];
      if (q.progress(this.questCtx()) < q.max) break;
      this.quest++; changed = true;
      if (q.reward.length) this.giveLoot(q.reward, 'reward');
      if (!silent) { this.o.audio.quest(); this.hud.banner('ЗАДАНИЕ ВЫПОЛНЕНО', q.title, 'quest'); }
    }
    this.updateQuestHud();
    return changed;
  }

  private updateQuestHud() {
    const q = QUESTS[this.quest];
    this.hud.setQuest(q ? { n: this.quest + 1, total: QUESTS.length, title: q.title, desc: q.desc, cur: q.progress(this.questCtx()), max: q.max } : null);
  }

  private updatePlayersHud() {
    if (this.o.transport.solo) { this.hud.setPlayers([], null); return; }
    const me = this.o.transport.snapshot.players.find((p) => p.id === this.myId)!;
    this.hud.setPlayers([{ name: me.name, color: me.color, dead: this.dead, me: true }, ...[...this.remotes.values()].map((r) => ({ name: r.net.name, color: r.net.color, dead: r.net.dead, me: false }))], this.o.transport.snapshot.code);
  }

  private drawMap(cv: HTMLCanvasElement, full: boolean) {
    const ctx = cv.getContext('2d')!;
    const W = cv.width, img = this.mapImg, ms = img.width / (WORLD_HALF * 2);
    const span = full ? WORLD_HALF * 2 : 170;
    const cx = full ? 0 : this.pos.x, cz = full ? 0 : this.pos.z;
    const sc = W / span;
    ctx.fillStyle = '#10161c'; ctx.fillRect(0, 0, W, W);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, (cx - span / 2 + WORLD_HALF) * ms, (cz - span / 2 + WORLD_HALF) * ms, span * ms, span * ms, 0, 0, W, W);
    const P = (x: number, z: number): [number, number] => [(x - cx) * sc + W / 2, (z - cz) * sc + W / 2];
    const dot = (x: number, z: number, r: number, fill: string, strokeC = 'rgba(0,0,0,.7)') => { const [px, pz] = P(x, z); ctx.beginPath(); ctx.arc(px, pz, r, 0, 6.283); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = strokeC; ctx.stroke(); };
    if (full) for (const zn of this.world.zones) if (this.discovered.has('zone:' + zn.id)) { const [px, pz] = P(zn.x, zn.z); ctx.beginPath(); ctx.arc(px, pz, zn.r * sc, 0, 6.283); ctx.fillStyle = 'rgba(220,60,40,.16)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,90,60,.7)'; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]); }
    for (const b of this.buildings.values()) if (b.type === 'campfire') dot(b.x, b.z, full ? 3 : 3.5, '#ff9a3d'); else if (b.type === 'foundation') { const [px, pz] = P(b.x, b.z); ctx.fillStyle = '#d9b27a'; ctx.fillRect(px - 2 * sc, pz - 2 * sc, 4 * sc, 4 * sc); }
    ctx.font = `600 ${full ? 13 : 11}px system-ui, sans-serif`; ctx.textAlign = 'center';
    for (const p of this.world.pois) {
      if (!this.discovered.has(p.id)) continue;
      const [px, pz] = P(p.x, p.z);
      ctx.save(); ctx.translate(px, pz); ctx.rotate(Math.PI / 4); ctx.fillStyle = '#f4efe4'; ctx.strokeStyle = '#1a1d22'; ctx.lineWidth = 2; ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8); ctx.restore();
      if (full) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(p.name, px, pz - 10); ctx.fillStyle = '#fff'; ctx.fillText(p.name, px, pz - 10); }
    }
    const q = QUESTS[this.quest];
    for (const m of q?.markers?.(this.questCtx()) ?? []) {
      let [px, pz] = P(m.x, m.z);
      if (!full) { const dx = px - W / 2, dz = pz - W / 2, d = Math.hypot(dx, dz), R = W / 2 - 12; if (d > R) { px = W / 2 + (dx / d) * R; pz = W / 2 + (dz / d) * R; } }
      ctx.beginPath(); ctx.arc(px, pz, full ? 7 : 6, 0, 6.283); ctx.fillStyle = '#ffd34a'; ctx.fill(); ctx.strokeStyle = '#3a2a00'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#3a2a00'; ctx.fillText('!', px, pz + 4);
    }
    if (!full) for (const c of this.creatures.values()) { if (c.anim === 4 || c.type === 'deer') continue; const d = Math.hypot(c.root.position.x - cx, c.root.position.z - cz); if (d < 42) dot(c.root.position.x, c.root.position.z, 3, '#e5402f'); }
    for (const r of this.remotes.values()) dot(r.model.root.position.x, r.model.root.position.z, full ? 5 : 4.5, '#' + r.net.color.toString(16).padStart(6, '0'), '#fff');
    const [px, pz] = P(this.pos.x, this.pos.z);
    ctx.save(); ctx.translate(px, pz); ctx.rotate(Math.PI - this.facing);
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  }

  // ================================================================ simulation
  private respawn() {
    const sp = this.world.spawn;
    this.pos.set(sp.x, this.world.heightAt(sp.x, sp.z), sp.z);
    this.vel.set(0, 0, 0);
    this.stats = { hp: 60, hunger: Math.max(this.stats.hunger, 45), thirst: Math.max(this.stats.thirst, 45), stamina: 100 };
    this.dead = false;
    this.updatePlayersHud();
  }

  private die(cause: string) {
    if (this.dead) return;
    this.dead = true; this.stats.hp = 0;
    this.tally.deaths++;
    this.exitBuild();
    this.o.audio.death();
    this.hud.showDeath(cause);
    this.updatePlayersHud();
  }

  private movePlayer(dt: number) {
    const k = this.keys, w = this.world;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const canMove = !this.dead && !this.hud.panel;
    let wx = 0, wz = 0;
    if (canMove && (f || r)) {
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      wx = sy * f - cy * r; wz = cy * f + sy * r;
      const l = Math.hypot(wx, wz); wx /= l; wz /= l;
    }
    const moving = wx !== 0 || wz !== 0;
    const th = w.heightAt(this.pos.x, this.pos.z);
    this.swimming = th < -1.05 && this.pos.y < -0.9;
    const weak = this.stats.hunger <= 0 || this.stats.thirst <= 0;
    const sprint = moving && k.has('ShiftLeft') && this.stats.stamina > 0.5 && !this.swimming;
    let speed = this.swimming ? SWIM : sprint ? RUN : WALK;
    if (weak) speed *= 0.78;
    if (th < -0.3 && !this.swimming && this.pos.y < 0.2) speed *= 0.7;
    if (sprint) { this.stats.stamina -= 11 * dt; this.staminaDelay = 0.7; }
    if (this.swimming && moving) { this.stats.stamina -= 4 * dt; this.staminaDelay = 0.7; }
    const accel = this.onGround || this.swimming ? 13 : 3.5;
    const kk = Math.min(1, accel * dt);
    this.vel.x += (wx * speed - this.vel.x) * kk; this.vel.z += (wz * speed - this.vel.z) * kk;
    if (moving && !this.me.swinging) this.facing += clamp(angleDiff(this.facing, Math.atan2(wx, wz)), -12 * dt, 12 * dt);
    else if (this.me.swinging) this.facing += clamp(angleDiff(this.facing, this.yaw), -16 * dt, 16 * dt);

    if (canMove && k.has('Space') && this.onGround && !this.swimming && this.stats.stamina >= 6) {
      this.vel.y = JUMP; this.onGround = false; this.stats.stamina -= 7; this.staminaDelay = 0.7; k.delete('Space');
    }

    // horizontal move with slope blocking and sliding
    const p = this.pos;
    const tryMove = (nx: number, nz: number): boolean => {
      if (nx * nx + nz * nz > PLAY_RADIUS * PLAY_RADIUS) return false;
      const nh = w.heightAt(nx, nz);
      if (nh > p.y + 0.03 && nh > th && w.slopeAt(nx, nz) > 1.15 && w.groundAt(nx, nz, p.y) <= nh) return false;
      p.x = nx; p.z = nz; return true;
    };
    const dx = this.vel.x * dt, dz = this.vel.z * dt;
    if (dx || dz) { if (!tryMove(p.x + dx, p.z + dz)) { if (!tryMove(p.x + dx, p.z)) tryMove(p.x, p.z + dz); } }
    w.colliders.resolve(p, RADIUS, p.y);

    // vertical
    const g = w.groundAt(p.x, p.z, p.y);
    const floor = g < -1.05 ? -1.05 : g;
    if (!this.onGround || this.vel.y > 0) { this.vel.y -= GRAV * dt; p.y += this.vel.y * dt; }
    if (p.y <= floor || (this.onGround && this.vel.y <= 0 && p.y - floor < 0.55)) {
      if (!this.onGround && this.vel.y < -13 && g >= -1.05) { const dmg = Math.round((-this.vel.y - 13) * 4.5); this.stats.hp -= dmg; this.lastHurtBy = 'fall'; this.hud.flashDamage(); this.o.audio.hurt(); }
      if (!this.onGround && this.vel.y < -3) this.o.audio.step(this.surface(), true);
      p.y = floor; this.vel.y = 0; this.onGround = true;
    } else if (p.y - floor >= 0.55) this.onGround = false;
  }

  private survive(dt: number) {
    const s = this.stats;
    const sprinting = this.keys.has('ShiftLeft') && Math.hypot(this.vel.x, this.vel.z) > 5;
    s.hunger = Math.max(0, s.hunger - dt * (100 / 620) * (sprinting ? 1.5 : 1));
    s.thirst = Math.max(0, s.thirst - dt * (100 / 470) * (sprinting ? 1.5 : 1) * (this.sky.w.rain > 0.3 ? 0.6 : 1));
    this.staminaDelay -= dt;
    if (this.staminaDelay <= 0) s.stamina = Math.min(100, s.stamina + dt * 17 * (s.hunger < 15 || s.thirst < 15 ? 0.5 : 1));
    s.stamina = Math.max(0, s.stamina);
    const warm = this.fire.nearestFire < 5;
    if (s.hunger > 40 && s.thirst > 40) s.hp += dt * 0.55;
    if (warm) s.hp += dt * 1.3;
    let cause = '';
    if (s.hunger <= 0) { s.hp -= dt * 1.2; cause = 'Вы умерли от голода.'; }
    if (s.thirst <= 0) { s.hp -= dt * 1.8; cause = 'Вы умерли от жажды.'; }
    const zone = this.world.zoneAt(this.pos.x, this.pos.z);
    if (zone?.kind === 'radiation') { s.hp -= dt * 2.1; cause = 'Вас убило заражение.'; }
    if (this.swimming && s.stamina <= 0) { s.hp -= dt * 4; cause = 'Вы утонули.'; }
    s.hp = Math.min(100, s.hp);
    if (s.hp <= 0) {
      if (!cause || this.lastHurtBy) cause = this.lastHurtBy === 'fall' ? 'Вы разбились при падении.' : this.lastHurtBy ? `Вас убил ${this.lastHurtBy.toLowerCase()}.` : cause || 'Вы погибли.';
      this.die(cause);
    }
    if (s.hp > 30) this.lastHurtBy = '';

    // discovery & danger zones
    for (const p of this.world.pois) {
      if (!this.discovered.has(p.id) && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < p.r + 10) {
        this.discovered.add(p.id);
        if (p.id !== 'camp') { this.hud.banner('ОБНАРУЖЕНО', p.name, 'info'); this.o.audio.quest(); }
      }
    }
    const zid = zone?.id ?? null;
    if (zid !== this.zoneId) {
      this.zoneId = zid;
      if (zone) { this.discovered.add('zone:' + zone.id); this.hud.banner('ОПАСНАЯ ЗОНА', zone.name, 'danger'); }
    }
    const night = this.time >= 21 || this.time < 4.75;
    this.hud.setDanger(zone?.kind === 'radiation' ? '☢ Заражение: здоровье убывает' : zone ? `Опасная зона: ${zone.name}` : night && !warm ? 'Ночь. Ночные охотники вышли на охоту — держитесь у огня' : null);
  }

  private updateCamera(dt: number) {
    const head = this.v3.copy(this.pos); head.y += 1.55 + (this.swimming ? -0.5 : 0);
    this.camTarget.lerp(head, 1 - Math.exp(-dt * 14));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = -Math.sin(this.yaw) * cp, dy = sp, dz = -Math.cos(this.yaw) * cp;
    let allowed = this.camDist;
    for (let i = 1; i <= 12; i++) {
      const d = (this.camDist * i) / 12;
      const x = this.camTarget.x + dx * d, y = this.camTarget.y + dy * d, z = this.camTarget.z + dz * d;
      if (y < this.world.heightAt(x, z) + 0.35 || this.world.colliders.overlaps(x, z, 0.25, y - 0.15, y + 0.15, 'node')) { allowed = Math.max(0.9, d - this.camDist / 12); break; }
    }
    this.camCur += (allowed - this.camCur) * (allowed < this.camCur ? 1 : Math.min(1, dt * 5));
    this.camera.position.set(this.camTarget.x + dx * this.camCur, Math.max(this.camTarget.y + dy * this.camCur, 0.25), this.camTarget.z + dz * this.camCur);
    this.camera.lookAt(this.camTarget.x, this.camTarget.y + 0.25, this.camTarget.z);
  }

  private emitter(pos: THREE.Vector3, kind: Emitter['kind']) {
    const e = this.emitterPool.pop() ?? { pos: new THREE.Vector3(), kind };
    e.pos.copy(pos); e.kind = kind; this.emitters.push(e);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const real = (now - this.last) / 1000;
    this.last = now;
    this.acc.frames++; this.acc.fps += real;
    if (this.acc.fps >= 0.5) {
      this.hud.setFps(this.o.settings.showFps ? `${Math.round(this.acc.frames / this.acc.fps)} FPS · ${this.renderer.info.render.calls} dc · ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k tris` : '');
      this.acc.frames = 0; this.acc.fps = 0;
    }
    try {
      // on slow machines run several fixed sub-steps so game speed does not depend on frame rate
      if (this.manual) return;
      this.step(Math.min(real, 0.4));
      this.renderer.render(this.scene, this.camera);
      if (!this.firstFrame) { this.firstFrame = true; console.info(`[boot] first frame rendered in ${Math.round(performance.now() - now)}ms`); }
    } catch (e) { console.error('frame error', e); }
  };

  /** Advance the simulation by `seconds` in fixed sub-steps (also used by automated tests). */
  step(seconds: number) {
    let left = seconds;
    while (left > 1e-4) { const dt = Math.min(0.05, left); this.update(dt); left -= dt; }
  }

  private update(dt: number) {
    const paused = this.o.transport.solo && (this.hud.panel === 'pause' || this.hud.panel === 'settings');
    if (paused) return;
    this.clock += dt;
    this.tally.playtime += dt;
    this.o.transport.update(dt);
    this.time += (dt * 24) / this.dayLength; if (this.time >= 24) this.time -= 24;

    this.swingCd -= dt; this.useCd -= dt;
    if (this.hitTimer >= 0) { this.hitTimer -= dt; if (this.hitTimer < 0 && !this.dead) this.resolveHit(); }
    this.movePlayer(dt);
    if (!this.dead) this.survive(dt);

    // local character
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let anim = this.dead ? A_DEAD : this.swimming ? A_SWIM : !this.onGround ? A_JUMP : sp > 5.6 ? A_RUN : sp > 0.4 ? A_WALK : A_IDLE;
    if (this.me.swinging) anim |= A_SWING;
    this.me.root.position.copy(this.pos);
    this.me.root.rotation.y = this.facing;
    this.me.update(dt, anim, sp, this.clock);

    // remote players
    const kk = 1 - Math.exp(-dt * 12);
    for (const r of this.remotes.values()) {
      const p = r.model.root.position;
      if (Math.hypot(r.tx - p.x, r.tz - p.z) > 15) p.set(r.tx, r.ty, r.tz);
      else { p.x += (r.tx - p.x) * kk; p.y += (r.ty - p.y) * kk; p.z += (r.tz - p.z) * kk; }
      r.model.root.rotation.y += angleDiff(r.model.root.rotation.y, r.try_) * kk;
      const base = r.anim & 7;
      r.model.update(dt, r.anim, base === A_RUN ? RUN : WALK, this.clock);
      r.tag.visible = p.distanceTo(this.pos) < 60;
    }
    for (const c of this.creatures.values()) c.update(dt, this.camera);

    // interaction target, build ghost
    if (!this.hud.panel && !this.dead) {
      if (this.build) { this.updateBuild(); this.target = null; this.hud.setPrompt(null); }
      else { this.target = this.findTarget(); this.hud.setPrompt(this.promptFor(this.target)); }
    } else { this.target = null; if (this.build && this.dead) this.exitBuild(); }
    if (this.openChestId !== null) { const b = this.buildings.get(this.openChestId); if (!b || Math.hypot(b.x - this.pos.x, b.z - this.pos.z) > 5) this.hud.forceClose(); }
    this.builds.update(dt, this.openChestId);

    // environment
    this.updateCamera(dt);
    this.sky.update(this.time, this.weather, this.pos, this.camera.position, dt);
    if (this.weatherFx.flashRequest) { this.sky.flash = 1; this.weatherFx.flashRequest = 0; }
    this.weatherFx.update(dt, this.clock, this.camera.position, this.sky.w.rain, this.sky.w.wind, this.weather === 'storm', this.sky.dayF);
    this.veg.update(dt, this.clock, this.camera.position, this.sky.w.wind);
    this.terrain.waterMat.color.setRGB(0.07 + 0.11 * this.sky.dayF, 0.2 + 0.3 * this.sky.dayF, 0.26 + 0.29 * this.sky.dayF);
    this.terrain.water.position.y = -0.12 + Math.sin(this.clock * 0.8) * 0.03;
    this.particles.update(dt);
    this.structs.setRadio(this.radio.state, this.clock);

    for (const e of this.emitters) this.emitterPool.push(e);
    this.emitters.length = 0;
    for (const f of this.structs.fires) this.emitter(f, 'fire');
    for (const b of this.buildings.values()) if (b.type === 'campfire') this.emitter(this.v3.set(b.x, b.y, b.z), 'fire');
    if (this.me.held === 'torch' && !this.dead) this.emitter(this.me.torchPos, 'torch');
    for (const r of this.remotes.values()) if (r.model.held === 'torch') this.emitter(r.model.torchPos, 'torch');
    if (this.sky.night > 0.3) for (const l of this.structs.lanterns) this.emitter(l, 'lantern');
    this.fire.update(this.clock, this.emitters, this.pos, this.sky.w.rain);

    const rd = this.world.riverDist(this.pos.x, this.pos.z);
    this.o.audio.setAmbience({ rain: this.sky.w.rain, wind: this.sky.w.wind, night: this.sky.night, fire: clamp(1 - this.fire.nearestFire / 14, 0, 1), water: clamp(1 - rd / 30, 0, 1) });
    this.o.audio.update(dt);

    // periodic work
    this.acc.net += dt;
    if (this.acc.net >= 0.066) {
      this.acc.net = 0;
      this.send('state', { x: this.pos.x, y: this.pos.y, z: this.pos.z, ry: this.facing, anim, held: this.inv.held, dead: this.dead });
    }
    this.acc.ui += dt;
    if (this.acc.ui >= 0.1) {
      this.acc.ui = 0;
      this.hud.setStats(this.stats.hp, this.stats.hunger, this.stats.thirst, this.stats.stamina);
      this.hud.setClock(this.time, this.day, this.weather, this.sky.night > 0.5);
      this.hud.setRadio(this.radio.state === 'tx' ? this.radio.progress : null);
      this.drawMap(this.hud.minimap, false);
      if (this.hud.panel === 'map') this.hud.refreshMap();
    }
    this.acc.quest += dt;
    if (this.acc.quest >= 0.4) { this.acc.quest = 0; this.checkQuests(); if (!this.o.transport.solo) this.updatePlayersHud(); }
    this.acc.save += dt;
    if (this.acc.save >= 30) { this.acc.save = 0; this.saveGame(); }
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
}
