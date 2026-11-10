// Procedurally built and animated low-poly humanoid + enemy creatures.
import * as THREE from 'three';
import type { ItemId } from '../../shared/items';
import type { EnemyType } from '../../shared/room';
import { box, cone, cyl, ico, merge, part, TRS } from './geo';

const lam = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const vmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

export const A_IDLE = 0, A_WALK = 1, A_RUN = 2, A_JUMP = 3, A_SWIM = 4, A_DEAD = 5, A_SWING = 8;

const heldCache = new Map<string, THREE.BufferGeometry>();
function heldGeo(id: ItemId): THREE.BufferGeometry | null {
  if (heldCache.has(id)) return heldCache.get(id)!;
  let g: THREE.BufferGeometry | null = null;
  const handle = (len: number) => part(cyl(0.028, 0.034, len, 5), 0x8a5a36, TRS(0, len / 2 - 0.15, 0));
  if (id === 'axe') g = merge([handle(0.85), part(box(0.07, 0.2, 0.3), 0x8d8c9e, TRS(0, 0.6, 0.14), 0.05), part(box(0.05, 0.26, 0.08), 0xb9b8c6, TRS(0, 0.6, 0.31))]);
  else if (id === 'pickaxe') g = merge([handle(0.9), part(box(0.08, 0.1, 0.75), 0x8d8c9e, TRS(0, 0.7, 0), 0.05), part(cone(0.05, 0.22, 4), 0xb9b8c6, TRS(0, 0.7, 0.46, Math.PI / 2)), part(cone(0.05, 0.22, 4), 0xb9b8c6, TRS(0, 0.7, -0.46, -Math.PI / 2))]);
  else if (id === 'hammer') g = merge([handle(0.7), part(box(0.14, 0.16, 0.34), 0x77768a, TRS(0, 0.5, 0), 0.05)]);
  else if (id === 'torch') g = merge([handle(0.75), part(cyl(0.06, 0.045, 0.16, 6), 0x3a2a20, TRS(0, 0.62, 0))]);
  else if (id === 'spear') g = merge([part(cyl(0.022, 0.026, 2.0, 5), 0x8a5a36, TRS(0, 0.55, 0)), part(cone(0.06, 0.3, 4), 0xb9b8c6, TRS(0, 1.7, 0))]);
  else if (id === 'wood') g = merge([part(cyl(0.07, 0.07, 0.5, 6), 0x8a5a36, TRS(0, 0.05, 0.05, Math.PI / 2))]);
  if (g) heldCache.set(id, g);
  return g;
}

export class Humanoid {
  root = new THREE.Group();
  private body = new THREE.Group();
  private torso: THREE.Group;
  private head: THREE.Mesh;
  private armL: THREE.Group; private armR: THREE.Group;
  private legL: THREE.Group; private legR: THREE.Group;
  private hand = new THREE.Group();
  private heldMesh: THREE.Mesh | null = null;
  private heldId: ItemId | null = null;
  flame: THREE.Mesh | null = null;
  private phase = 0;
  private swingT = -1;
  private deadK = 0;
  private lastStep = 0;
  onStep: (() => void) | null = null;
  /** world position of the torch flame (valid when a torch is held) */
  torchPos = new THREE.Vector3();
  private mats: THREE.Material[] = [];

  constructor(shirt: number, pack = 0xe3a53a) {
    const skin = lam(0xd9a273), cloth = lam(shirt), pants = lam(0x3d4654), boot = lam(0x2b2622), packM = lam(pack), hat = lam(0x5a4634);
    this.mats.push(skin, cloth, pants, boot, packM, hat);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; return o; };
    this.torso = new THREE.Group(); this.torso.position.y = 0.92;
    this.torso.add(mesh(box(0.5, 0.6, 0.28), cloth, 0, 0.32, 0));
    this.torso.add(mesh(box(0.46, 0.12, 0.27), pants, 0, 0.02, 0));
    this.torso.add(mesh(box(0.4, 0.48, 0.2), packM, 0, 0.36, -0.24));
    this.torso.add(mesh(cyl(0.09, 0.09, 0.44, 6).rotateZ(Math.PI / 2), lam(0x7a8a9a), 0, 0.66, -0.25));
    this.torso.add(mesh(box(0.3, 0.14, 0.05), lam(0xb9792c), 0, 0.26, -0.35));
    this.head = mesh(box(0.3, 0.3, 0.3), skin, 0, 0.8, 0);
    this.head.add(mesh(box(0.34, 0.1, 0.34), hat, 0, 0.17, 0));
    this.head.add(mesh(box(0.5, 0.03, 0.5), hat, 0, 0.12, 0));
    this.head.add(mesh(box(0.05, 0.05, 0.02), lam(0x20242c), -0.07, 0.02, 0.151));
    this.head.add(mesh(box(0.05, 0.05, 0.02), lam(0x20242c), 0.07, 0.02, 0.151));
    this.torso.add(this.head);
    const arm = (side: number) => {
      const g = new THREE.Group(); g.position.set(side * 0.33, 0.56, 0);
      g.add(mesh(box(0.15, 0.36, 0.16), cloth, 0, -0.16, 0));
      g.add(mesh(box(0.13, 0.3, 0.14), skin, 0, -0.47, 0));
      this.torso.add(g); return g;
    };
    this.armL = arm(-1); this.armR = arm(1);
    this.hand.position.set(0, -0.6, 0.04); this.hand.rotation.x = Math.PI / 2;
    this.armR.add(this.hand);
    const leg = (side: number) => {
      const g = new THREE.Group(); g.position.set(side * 0.13, 0.9, 0);
      g.add(mesh(box(0.2, 0.74, 0.22), pants, 0, -0.37, 0));
      g.add(mesh(box(0.22, 0.18, 0.32), boot, 0, -0.81, 0.04));
      this.body.add(g); return g;
    };
    this.legL = leg(-1); this.legR = leg(1);
    this.body.add(this.torso);
    this.root.add(this.body);
  }

  setHeld(id: ItemId | null) {
    if (id === this.heldId) return;
    this.heldId = id;
    if (this.heldMesh) { this.hand.remove(this.heldMesh); this.heldMesh = null; }
    if (this.flame) { this.flame.geometry.dispose(); (this.flame.material as THREE.Material).dispose(); this.flame = null; }
    const g = id ? heldGeo(id) : null;
    if (!g) return;
    this.heldMesh = new THREE.Mesh(g, vmat);
    this.heldMesh.castShadow = true;
    this.hand.add(this.heldMesh);
    if (id === 'torch') {
      this.flame = new THREE.Mesh(cone(0.09, 0.3, 5), new THREE.MeshBasicMaterial({ color: 0xffb040 }));
      this.flame.position.y = 0.82;
      this.heldMesh.add(this.flame);
    }
  }
  get held() { return this.heldId; }

  swing() { this.swingT = 0; }
  get swinging() { return this.swingT >= 0; }

  /** speed in m/s on the ground plane */
  update(dt: number, anim: number, speed: number, time: number) {
    const base = anim & 7;
    const dead = base === A_DEAD;
    this.deadK += ((dead ? 1 : 0) - this.deadK) * Math.min(1, dt * 5);
    this.body.rotation.x = -this.deadK * Math.PI / 2;
    this.body.position.y = this.deadK * 0.2;
    this.body.position.z = this.deadK * 0.8;
    const moving = base === A_WALK || base === A_RUN;
    const run = base === A_RUN;
    if (moving) this.phase += dt * Math.max(speed, 1.5) * (run ? 1.3 : 1.55);
    else if (base === A_SWIM) this.phase += dt * 5;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const ease = Math.min(1, dt * 12);
    let lL = 0, lR = 0, aL = 0, aR = 0, lean = 0, bob = 0, aRz = 0, aLz = 0, twist = 0;
    if (moving) {
      const amp = run ? 0.95 : 0.55;
      lL = s * amp; lR = -s * amp; aL = -s * amp * 0.85; aR = s * amp * 0.85;
      lean = run ? 0.16 : 0.04; bob = Math.abs(c) * (run ? 0.07 : 0.035);
      const step = Math.floor(this.phase / Math.PI);
      if (step !== this.lastStep) { this.lastStep = step; this.onStep?.(); }
    } else if (base === A_JUMP) { lL = 0.55; lR = -0.35; aL = 2.2; aR = 2.4; aLz = -0.3; aRz = 0.3; lean = 0.08; }
    else if (base === A_SWIM) { lL = s * 0.5; lR = -s * 0.5; aL = 1.7 + c * 0.9; aR = 1.7 - c * 0.9; lean = 0.9; bob = -0.25; }
    else { bob = Math.sin(time * 1.8) * 0.012; aLz = -0.05; aRz = 0.05; }
    if (this.heldId === 'torch' && this.swingT < 0 && base !== A_SWIM) { aR = 1.25 + (moving ? s * 0.08 : 0); aRz = 0.1; }
    if (this.swingT >= 0) {
      this.swingT += dt;
      const k = this.swingT / 0.42;
      if (k >= 1) this.swingT = -1;
      else {
        const wind = k < 0.35 ? k / 0.35 : 1, strike = k < 0.35 ? 0 : (k - 0.35) / 0.65;
        aR = 2.7 * wind - 2.2 * Math.sin(strike * Math.PI / 2);
        aRz = -0.2; twist = (0.35 * wind - 0.8 * strike);
        lean += 0.12 * strike;
      }
    }
    const L = (o: THREE.Object3D, ax: 'x' | 'z' | 'y', v: number, k = ease) => { o.rotation[ax] += (v - o.rotation[ax]) * k; };
    const fast = this.swingT >= 0 ? 1 : ease;
    L(this.legL, 'x', -lL); L(this.legR, 'x', -lR);
    L(this.armL, 'x', -aL); L(this.armR, 'x', -aR, fast);
    L(this.armL, 'z', aLz); L(this.armR, 'z', aRz);
    L(this.torso, 'x', lean); L(this.torso, 'y', twist, fast);
    this.torso.position.y += (0.92 + bob - this.torso.position.y) * ease;
    if (this.flame) {
      const f = 0.85 + Math.sin(time * 23) * 0.12 + Math.sin(time * 37) * 0.08;
      this.flame.scale.set(f, 0.8 + f * 0.4, f);
      this.flame.getWorldPosition(this.torchPos);
    }
  }

  dispose() { for (const m of this.mats) m.dispose(); }
}

/** Limb convention: animation values are 'forward amount'; rotation.x = -value (positive x swings backwards). */

// ------------------------------------------------------------------ name tag
export function nameTag(text: string, color: number): THREE.Sprite {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.font = '600 30px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = Math.min(240, ctx.measureText(text).width + 28);
  ctx.fillStyle = 'rgba(10,12,16,0.6)';
  ctx.beginPath(); ctx.roundRect(128 - w / 2, 12, w, 40, 10); ctx.fill();
  ctx.fillStyle = '#' + new THREE.Color(color).getHexString(); ctx.fillRect(128 - w / 2, 48, w, 4);
  ctx.fillStyle = '#fff'; ctx.fillText(text, 128, 32, 220);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
  sp.scale.set(1.9, 0.48, 1); sp.position.y = 2.25; sp.renderOrder = 5;
  return sp;
}

// ------------------------------------------------------------------ creatures
export class Creature {
  root = new THREE.Group();
  private body = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private headG = new THREE.Group();
  private mat: THREE.MeshLambertMaterial;
  private bar: THREE.Group;
  private barFill: THREE.Mesh;
  private phase = Math.random() * 6;
  private flash = 0;
  private deadT = 0;
  private attackT = 0;
  hp = 1;
  anim = 0;
  // network interpolation
  tx = 0; ty = 0; tz = 0; try_ = 0;
  seen = 0;

  constructor(public type: EnemyType) {
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const M = (g: THREE.BufferGeometry, parent: THREE.Object3D = this.body) => { const m = new THREE.Mesh(g, this.mat); m.castShadow = true; parent.add(m); return m; };
    const limb = (x: number, y: number, z: number, g: THREE.BufferGeometry, list: THREE.Group[]) => { const p = new THREE.Group(); p.position.set(x, y, z); M(g, p); this.body.add(p); list.push(p); return p; };
    if (type === 'wolf' || type === 'deer') {
      const deer = type === 'deer';
      const c1 = deer ? 0xa9744a : 0x6e7480, c2 = deer ? 0xd9c3a0 : 0x4d525c, H = deer ? 1.05 : 0.7, len = deer ? 1.3 : 1.25;
      M(merge([part(box(0.42, deer ? 0.5 : 0.42, len), c1, TRS(0, H, 0), 0.06), part(box(0.36, 0.2, len * 0.9), c2, TRS(0, H - 0.26, 0), 0.04),
        deer ? part(box(0.12, 0.14, 0.12), 0xf2ead8, TRS(0, H + 0.1, -len / 2 - 0.03)) : part(box(0.1, 0.1, 0.55), c2, TRS(0, H + 0.1, -len / 2 - 0.22, -0.5))]));
      this.headG.position.set(0, H + (deer ? 0.45 : 0.2), len / 2 + 0.05);
      const hp: THREE.BufferGeometry[] = [part(box(0.26, 0.26, 0.34), c1, TRS(0, 0, 0.1), 0.05), part(box(0.16, 0.14, 0.24), c2, TRS(0, -0.05, 0.36)), part(box(0.07, 0.05, 0.03), 0x15171a, TRS(0, -0.02, 0.485)),
        part(cone(0.06, 0.16, 3), c1, TRS(-0.1, 0.19, 0)), part(cone(0.06, 0.16, 3), c1, TRS(0.1, 0.19, 0))];
      if (deer) { hp.push(part(box(0.18, 0.5, 0.2), c1, TRS(0, -0.3, -0.05, 0.4))); for (const s of [-1, 1]) hp.push(part(cyl(0.015, 0.03, 0.5, 4), 0xe6dcc2, TRS(s * 0.14, 0.4, -0.02, 0, 0, -s * 0.5)), part(cyl(0.012, 0.02, 0.28, 4), 0xe6dcc2, TRS(s * 0.26, 0.52, 0.05, 0.5, 0, -s * 0.2))); }
      else hp.push(part(box(0.03, 0.03, 0.02), 0xffd34a, TRS(-0.08, 0.05, 0.275), 0), part(box(0.03, 0.03, 0.02), 0xffd34a, TRS(0.08, 0.05, 0.275), 0));
      M(merge(hp), this.headG); this.body.add(this.headG);
      const lg = () => part(box(0.12, H - 0.1, 0.13), c2, TRS(0, -(H - 0.1) / 2, 0), 0.04);
      for (const [x, z] of [[-0.15, len / 2 - 0.12], [0.15, len / 2 - 0.12], [-0.15, -len / 2 + 0.12], [0.15, -len / 2 + 0.12]]) limb(x, H - 0.1, z, lg(), this.legs);
    } else {
      const st = type === 'stalker';
      const c1 = st ? 0x17161f : 0x7a8f5a, c2 = st ? 0x0c0b12 : 0x5b6b48, c3 = st ? 0x2a2838 : 0xa8707a;
      const H = st ? 1.55 : 1.05;
      M(merge([part(box(st ? 0.5 : 0.75, st ? 0.9 : 0.7, st ? 0.3 : 0.5), c1, TRS(0, H + 0.35, 0, 0.25), 0.07), part(box(0.4, 0.3, 0.3), c2, TRS(0, H, 0), 0.05),
        ...(st ? [0, 1, 2].map((i) => part(cone(0.07, 0.4, 4), c3, TRS(0, H + 0.45 + i * 0.22, -0.2 - i * 0.02, -1.1))) : [part(ico(0.22, 0), c3, TRS(0.25, H + 0.72, -0.1)), part(ico(0.16, 0), c3, TRS(-0.3, H + 0.5, 0.2))])]));
      this.headG.position.set(0, H + (st ? 0.95 : 0.75), 0.2);
      M(merge([part(box(st ? 0.24 : 0.3, st ? 0.34 : 0.28, 0.28), st ? c2 : c3, undefined, 0.05), part(box(0.2, 0.08, 0.06), 0x1a0d10, TRS(0, -0.1, 0.13)),
        part(box(0.06, 0.04, 0.02), st ? 0xbfe6ff : 0xf5e04a, TRS(-0.07, 0.04, 0.145), 0), part(box(0.06, 0.04, 0.02), st ? 0xbfe6ff : 0xf5e04a, TRS(0.07, 0.04, 0.145), 0)]), this.headG);
      this.body.add(this.headG);
      const armL = st ? 1.25 : 0.95, legL = H;
      for (const s of [-1, 1]) {
        limb(s * (st ? 0.33 : 0.48), H + (st ? 0.7 : 0.55), 0.08, merge([part(box(st ? 0.1 : 0.2, armL, st ? 0.1 : 0.2), c2, TRS(0, -armL / 2, 0), 0.06), part(cone(0.06, 0.25, 4), st ? 0xbfc5d9 : 0xe8dcc0, TRS(0, -armL - 0.1, 0.03, Math.PI))]), this.arms);
        limb(s * 0.15, legL, 0, part(box(st ? 0.12 : 0.2, legL, st ? 0.13 : 0.22), c2, TRS(0, -legL / 2, 0), 0.05), this.legs);
      }
      if (st) { this.mat.emissive.set(0x1a2a55); this.mat.emissiveIntensity = 0.35; }
    }
    this.root.add(this.body);
    this.bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.09), new THREE.MeshBasicMaterial({ color: 0x15171c, depthTest: false, transparent: true, opacity: 0.8, fog: false }));
    this.barFill = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.055), new THREE.MeshBasicMaterial({ color: 0xe5533d, depthTest: false, fog: false }));
    this.barFill.position.z = 0.001; bg.renderOrder = 10; this.barFill.renderOrder = 11;
    this.bar.add(bg, this.barFill);
    this.bar.position.y = type === 'stalker' ? 3.0 : type === 'mutant' ? 2.4 : type === 'deer' ? 2.0 : 1.4;
    this.bar.visible = false;
    this.root.add(this.bar);
  }

  hit() { this.flash = 1; }

  update(dt: number, cam: THREE.Camera) {
    const k = 1 - Math.exp(-dt * 12);
    const p = this.root.position;
    const dx = this.tx - p.x, dz = this.tz - p.z;
    const sp = Math.hypot(dx, dz) * 12;
    if (Math.hypot(dx, dz) > 12) p.set(this.tx, this.ty, this.tz); else { p.x += dx * k; p.z += dz * k; p.y += (this.ty - p.y) * k; }
    let d = (this.try_ - this.root.rotation.y) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
    this.root.rotation.y += d * k;

    const dead = this.anim === 4;
    if (dead) { this.deadT += dt; this.body.rotation.z += (Math.PI / 2 - this.body.rotation.z) * Math.min(1, dt * 6); this.body.position.y = Math.max(-1.2, 0.25 - Math.max(0, this.deadT - 4) * 0.5); }
    const moving = !dead && (this.anim === 1 || this.anim === 2);
    if (moving) this.phase += dt * (this.anim === 2 ? 11 : 6) * Math.min(1.3, 0.5 + sp * 0.2);
    const s = Math.sin(this.phase), amp = moving ? (this.anim === 2 ? 0.8 : 0.4) : 0;
    const quad = this.type === 'wolf' || this.type === 'deer';
    this.legs.forEach((l, i) => { const ph = quad ? (i === 0 || i === 3 ? 1 : -1) : i === 0 ? 1 : -1; l.rotation.x += (s * amp * ph - l.rotation.x) * Math.min(1, dt * 14); });
    if (this.anim === 3) this.attackT += dt; else this.attackT = 0;
    const atk = this.anim === 3 ? Math.sin(Math.min(1, this.attackT / 0.42) * Math.PI) : 0;
    this.arms.forEach((a, i) => { const tgt = atk > 0 ? -1.9 * atk - 0.3 : -0.35 - s * amp * (i === 0 ? 1 : -1) * 0.7; a.rotation.x += (tgt - a.rotation.x) * Math.min(1, dt * 16); });
    this.headG.rotation.x = quad ? atk * -0.5 + (moving ? 0 : Math.sin(this.phase * 0.2 + performance.now() * 0.001) * 0.08) : 0;
    if (quad && !dead) this.body.position.z = atk * 0.35;
    if (!dead) this.body.position.y = moving ? Math.abs(Math.cos(this.phase)) * 0.05 : 0;

    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 5); }
    const st = this.type === 'stalker';
    this.mat.emissive.setRGB(st ? 0.1 + this.flash : this.flash, st ? 0.16 + this.flash * 0.4 : this.flash * 0.25, st ? 0.33 : this.flash * 0.2);
    this.mat.emissiveIntensity = st ? 0.35 + this.flash : this.flash;
    this.bar.visible = !dead && this.hp < 0.999;
    if (this.bar.visible) { this.bar.quaternion.copy(cam.quaternion); this.root.updateMatrixWorld(); this.bar.quaternion.premultiply(this.q.copy(this.root.quaternion).invert()); this.barFill.scale.x = Math.max(0.001, this.hp); this.barFill.position.x = -0.43 * (1 - this.hp); }
  }
  private q = new THREE.Quaternion();

  dispose() {
    this.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); } });
    this.mat.dispose();
  }
}
