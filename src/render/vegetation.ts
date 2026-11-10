// Instanced world objects: trees, rocks, pickups, crates, wind-animated grass.
import * as THREE from 'three';
import { mulberry32 } from '../../shared/rng';
import { GRID_N, WORLD_HALF, World, type NodeDef } from '../../shared/world';
import { Batch, box, cone, cyl, flatMat, ico, lumpy, merge, part, TRS, type BatchItem } from './geo';

function treeGeos(): THREE.BufferGeometry[] {
  const bark = 0xb06a3c, barkD = 0x8a4f30;
  // 0: tall redwood-style pine
  const pine = merge([
    part(cyl(0.3, 0.52, 11, 7), bark, TRS(0, 5.5, 0), 0.07, 0xc27a45),
    part(cyl(0.52, 0.8, 0.9, 7), barkD, TRS(0, 0.35, 0), 0.06),
    part(cone(2.7, 3.6, 7), 0x246a52, TRS(0, 7.6, 0), 0.08, 0x338a60),
    part(cone(2.25, 3.3, 7), 0x287258, TRS(0, 9.6, 0, 0, 0.5), 0.08, 0x389264),
    part(cone(1.75, 3.0, 7), 0x25694f, TRS(0, 11.5, 0, 0, 1.1), 0.08, 0x36895c),
    part(cone(1.15, 2.8, 6), 0x2a7354, TRS(0, 13.3, 0, 0, 0.3), 0.08, 0x3f9463),
  ]);
  // 1: fir
  const fir = merge([
    part(cyl(0.2, 0.3, 2.4, 6), barkD, TRS(0, 1.2, 0), 0.06),
    part(cone(2.2, 2.6, 7), 0x2a6b4a, TRS(0, 2.9, 0), 0.08, 0x3a8557),
    part(cone(1.8, 2.4, 7), 0x2d7250, TRS(0, 4.3, 0, 0, 0.6), 0.08, 0x3f8f5c),
    part(cone(1.35, 2.2, 7), 0x317a54, TRS(0, 5.7, 0, 0, 1.2), 0.08, 0x47995f),
    part(cone(0.85, 2.0, 6), 0x378258, TRS(0, 7.0, 0, 0, 0.2), 0.08, 0x52a566),
  ]);
  // 2: leafy tree with a warm canopy
  const leafy = merge([
    part(cyl(0.2, 0.34, 4.2, 6), 0x8f6a4a, TRS(0, 2.1, 0), 0.06),
    part(cyl(0.1, 0.15, 1.8, 5), 0x8f6a4a, TRS(0.6, 3.6, 0.1, 0, 0, -0.7), 0.06),
    part(lumpy(ico(2.0, 1), 0.5, 11), 0x6f9a3a, TRS(0, 5.6, 0, 0, 0, 0, 1, 0.85, 1), 0.1, 0xa9b548),
    part(lumpy(ico(1.4, 1), 0.4, 12), 0x7da33c, TRS(1.5, 4.8, 0.4, 0, 0, 0, 1, 0.8, 1), 0.1, 0xb8b84a),
    part(lumpy(ico(1.3, 1), 0.4, 13), 0x67933a, TRS(-1.3, 5.0, -0.5, 0, 0, 0, 1, 0.8, 1), 0.1, 0x9fb046),
  ]);
  // 3: dead tree
  const dead = merge([
    part(cyl(0.14, 0.36, 6.5, 6), 0x5b5148, TRS(0, 3.25, 0), 0.08),
    part(cyl(0.05, 0.12, 2.6, 5), 0x5b5148, TRS(0.8, 4.4, 0, 0, 0, -0.9), 0.08),
    part(cyl(0.05, 0.11, 2.2, 5), 0x5b5148, TRS(-0.6, 5.2, 0.3, 0.3, 0, 0.8), 0.08),
    part(cyl(0.04, 0.09, 1.7, 5), 0x5b5148, TRS(0.1, 6.0, -0.5, -0.8, 0, 0.1), 0.08),
  ]);
  return [pine, fir, leafy, dead];
}

function rockGeo(v: number): THREE.BufferGeometry {
  const sx = [1.25, 1.0, 1.4][v], sy = [0.85, 1.15, 0.7][v];
  return merge([
    part(lumpy(ico(1, 1), 0.34, 21 + v), 0x67667f, TRS(0, 0.35, 0, 0, 0, 0, sx, sy, 1), 0.1, 0x8b8a9c),
    part(lumpy(ico(0.5, 0), 0.2, 31 + v), 0x5c5b73, TRS(0.9, 0.1, 0.5), 0.1, 0x7c7b90),
  ]);
}

const NODE_COLOR_SPECIAL = 0x7fb6e8;

export class Vegetation {
  group = new THREE.Group();
  private trees: Batch[] = [];
  private stumps!: Batch;
  private rocks: Batch[] = [];
  private rubble!: Batch;
  private simple = new Map<string, Batch>();
  private berryFruit!: Batch;
  private crateLid!: Batch;
  /** node id -> index inside its batch */
  private slot = new Int32Array(0);
  private shakes: { id: number; t: number }[] = [];
  private grassMat: THREE.MeshLambertMaterial | null = null;
  private grassUniforms = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uHeight: { value: null as THREE.Texture | null }, uS: { value: 90 }, uWind: { value: 0.3 } };
  depleted = new Set<number>();

  constructor(private world: World, scene: THREE.Scene, heightTex: THREE.Texture, grassCount: number) {
    scene.add(this.group);
    const mat = flatMat();
    const nodes = world.nodes;
    this.slot = new Int32Array(nodes.length).fill(-1);
    const by = (f: (n: NodeDef) => boolean) => nodes.filter(f);
    const items = (list: NodeDef[], f?: (n: NodeDef) => Partial<BatchItem>): BatchItem[] => list.map((n, i) => {
      this.slot[n.id] = i;
      return { x: n.x, y: n.y, z: n.z, rot: n.rot, scale: n.scale, ...(f ? f(n) : {}) };
    });

    const tg = treeGeos();
    for (let v = 0; v < 4; v++) {
      const list = by((n) => n.kind === 'tree' && n.variant === v);
      this.trees[v] = new Batch(this.group, tg[v], mat, items(list, (n) => ({ y: n.y - 0.15, sy: n.scale * (0.9 + ((n.id * 37) % 20) / 80) })), { cast: true });
    }
    // stumps share one batch indexed by a separate table
    const allTrees = by((n) => n.kind === 'tree');
    this.stumpIdx = new Int32Array(nodes.length).fill(-1);
    allTrees.forEach((n, i) => (this.stumpIdx[n.id] = i));
    const stumpGeo = merge([part(cyl(0.42, 0.55, 0.6, 7), 0x9a5e36, TRS(0, 0.25, 0), 0.06), part(cyl(0.4, 0.4, 0.04, 7), 0xd9b27a, TRS(0, 0.56, 0), 0.03)]);
    this.stumps = new Batch(this.group, stumpGeo, mat, allTrees.map((n) => ({ x: n.x, y: n.y, z: n.z, rot: n.rot, scale: n.variant === 0 ? n.scale * 1.1 : n.scale * 0.7 })), { hidden: true });

    for (let v = 0; v < 3; v++) {
      const list = by((n) => n.kind === 'rock' && n.variant === v);
      this.rocks[v] = new Batch(this.group, rockGeo(v), mat, items(list), { cast: true });
    }
    const allRocks = by((n) => n.kind === 'rock');
    this.rubbleIdx = new Int32Array(nodes.length).fill(-1);
    allRocks.forEach((n, i) => (this.rubbleIdx[n.id] = i));
    const rubbleGeo = merge([part(lumpy(ico(0.3, 0), 0.1, 3), 0x5c5b73, TRS(0.3, 0.1, 0)), part(lumpy(ico(0.22, 0), 0.1, 4), 0x67667f, TRS(-0.3, 0.08, 0.2)), part(lumpy(ico(0.18, 0), 0.08, 5), 0x67667f, TRS(0, 0.06, -0.35))]);
    this.rubble = new Batch(this.group, rubbleGeo, mat, allRocks.map((n) => ({ x: n.x, y: n.y, z: n.z, rot: n.rot, scale: n.scale })), { hidden: true });

    const stoneGeo = merge([part(lumpy(ico(0.2, 0), 0.07, 41), 0x8c8b9e, TRS(0, 0.1, 0, 0, 0, 0, 1.2, 0.8, 1)), part(lumpy(ico(0.13, 0), 0.05, 42), 0x777689, TRS(0.24, 0.06, 0.1))]);
    this.simple.set('stone', new Batch(this.group, stoneGeo, mat, items(by((n) => n.kind === 'stone'))));
    const stickGeo = merge([part(cyl(0.035, 0.05, 1.1, 5), 0x8a5a36, TRS(0, 0.06, 0, 0, 0, Math.PI / 2)), part(cyl(0.03, 0.04, 0.8, 5), 0x9a6a40, TRS(0.1, 0.08, 0.12, 0, 0.9, Math.PI / 2))]);
    this.simple.set('stick', new Batch(this.group, stickGeo, mat, items(by((n) => n.kind === 'stick'))));
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.283; blades.push(part(cone(0.07, 0.9 + (i % 3) * 0.2, 3), 0x5f9a48, TRS(Math.cos(a) * 0.14, 0.45, Math.sin(a) * 0.14, Math.sin(a) * 0.35, a, -Math.cos(a) * 0.35), 0.08, 0xc9c36a)); }
    blades.push(part(ico(0.09, 0), 0xe8dca0, TRS(0, 1.05, 0)));
    this.simple.set('fiber', new Batch(this.group, merge(blades), mat, items(by((n) => n.kind === 'fiber'))));
    const berries = by((n) => n.kind === 'berry');
    const bushGeo = merge([part(lumpy(ico(0.62, 1), 0.16, 51), 0x3d7a45, TRS(0, 0.5, 0, 0, 0, 0, 1.15, 0.85, 1.1), 0.1, 0x5c9a4f), part(lumpy(ico(0.4, 0), 0.1, 52), 0x3a7242, TRS(0.5, 0.3, 0.25), 0.1)]);
    this.simple.set('berry', new Batch(this.group, bushGeo, mat, items(berries), { cast: true }));
    const fruit: THREE.BufferGeometry[] = [];
    const fr = mulberry32(9);
    for (let i = 0; i < 9; i++) { const a = fr() * 6.283, y = 0.35 + fr() * 0.6, r = 0.55 + fr() * 0.15; fruit.push(part(ico(0.075, 0), 0xd8324a, TRS(Math.cos(a) * r, y, Math.sin(a) * r * 0.95), 0.05)); }
    this.berryFruit = new Batch(this.group, merge(fruit), mat, berries.map((n) => ({ x: n.x, y: n.y, z: n.z, rot: n.rot, scale: n.scale })));
    const crates = by((n) => n.kind === 'crate');
    const crateGeo = merge([
      part(box(0.9, 0.62, 0.66), 0xa9743f, TRS(0, 0.31, 0), 0.05),
      part(box(0.94, 0.08, 0.7), 0x6f4a2a, TRS(0, 0.1, 0)), part(box(0.94, 0.08, 0.7), 0x6f4a2a, TRS(0, 0.52, 0)),
      part(box(0.1, 0.64, 0.7), 0x6f4a2a, TRS(-0.4, 0.31, 0)), part(box(0.1, 0.64, 0.7), 0x6f4a2a, TRS(0.4, 0.31, 0)),
    ]);
    const tint = (n: NodeDef) => ({ scale: 1, color: n.special ? NODE_COLOR_SPECIAL : 0xffffff });
    this.simple.set('crate', new Batch(this.group, crateGeo, mat, items(crates, tint), { cast: true }));
    const lidGeo = merge([part(box(0.96, 0.1, 0.72), 0xb98248, TRS(0, 0.67, 0), 0.04), part(box(0.2, 0.14, 0.06), 0x3b3b44, TRS(0, 0.6, 0.36))]);
    this.crateLid = new Batch(this.group, lidGeo, mat, crates.map((n) => ({ x: n.x, y: n.y, z: n.z, rot: n.rot, ...tint(n) })));

    this.buildDecor(mat);
    if (grassCount > 0) this.buildGrass(heightTex, grassCount);
  }
  private stumpIdx!: Int32Array;
  private rubbleIdx!: Int32Array;

  private buildDecor(mat: THREE.Material) {
    // non-interactive ferns and flowers for visual richness
    const rng = mulberry32(this.world.seed + 31337);
    const ferns: BatchItem[] = [], flowers: BatchItem[] = [];
    for (let i = 0; i < 4200; i++) {
      const x = (rng() * 2 - 1) * 296, z = (rng() * 2 - 1) * 296, r = rng(), sc = 0.7 + rng() * 0.8, rot = rng() * 6.283;
      const h = this.world.heightAt(x, z);
      if (h < 0.7 || h > 45 || this.world.slopeAt(x, z) > 0.8 || this.world.pathDist(x, z) < 2.5 || this.world.poiAt(x, z, -2)) continue;
      (r < 0.6 ? ferns : flowers).push({ x, y: h, z, rot, scale: sc, color: r < 0.6 ? undefined : [0xffffff, 0xf2c6ff, 0xffe08a, 0xff9a8a][Math.floor(rng() * 4)] });
    }
    const fg: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283; fg.push(part(new THREE.ConeGeometry(0.16, 1.0, 3, 1, true), 0x3f7a46, TRS(Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3, Math.sin(a) * 1.0, a, -Math.cos(a) * 1.0, 1, 1, 0.3), 0.1, 0x8fae4e)); }
    new Batch(this.group, merge(fg), mat, ferns);
    const stem = (h: number) => new THREE.CylinderGeometry(0.015, 0.02, h, 3, 1, true);
    const fl = merge([part(stem(0.4), 0x5c8a45, TRS(0, 0.2, 0)), part(new THREE.OctahedronGeometry(0.075), 0xffffff, TRS(0, 0.42, 0), 0), part(stem(0.3), 0x5c8a45, TRS(0.12, 0.15, 0.05, 0, 0, -0.3)), part(new THREE.OctahedronGeometry(0.06), 0xffffff, TRS(0.17, 0.31, 0.05), 0)]);
    new Batch(this.group, fl, mat, flowers);
  }

  private buildGrass(heightTex: THREE.Texture, count: number) {
    const S = this.grassUniforms.uS.value;
    const blade: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI + 0.2;
      const g = new THREE.BufferGeometry();
      const w = 0.075, h = 0.36 + (i % 2) * 0.16, lean = 0.12;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-w, 0, 0, w, 0, 0, lean, h, 0]), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
      const c0 = new THREE.Color(0x5f8a3e), c1 = new THREE.Color(0xb4c060);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([c0.r, c0.g, c0.b, c0.r, c0.g, c0.b, c1.r, c1.g, c1.b]), 3));
      g.applyMatrix4(TRS(Math.cos(a) * 0.1 - 0.05, 0, Math.sin(a) * 0.1, 0, a * 2.1, 0));
      blade.push(g);
    }
    const base = merge(blade);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    geo.setAttribute('color', base.getAttribute('color'));
    const off = new Float32Array(count * 3);
    const rng = mulberry32(777);
    for (let i = 0; i < count; i++) { off[i * 3] = rng() * S; off[i * 3 + 1] = rng() * S; off[i * 3 + 2] = rng(); }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.grassUniforms.uHeight.value = heightTex;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.grassUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec3 aOff; uniform vec3 uCam; uniform float uTime; uniform sampler2D uHeight; uniform float uS; uniform float uWind;`)
        .replace('#include <color_vertex>', `#include <color_vertex>
          vec2 gW = mod(aOff.xy - uCam.xz + uS * 0.5, uS) - uS * 0.5 + uCam.xz;
          vec4 gH = texture2D(uHeight, ((gW + ${WORLD_HALF}.0) * 0.5 + 0.5) / ${GRID_N}.0);
          float gFade = 1.0 - smoothstep(uS * 0.36, uS * 0.49, length(gW - uCam.xz));
          float gSc = step(0.25 + aOff.z * 0.5, gH.g + 0.2) * gH.g * gFade * (0.75 + aOff.z * 0.9);
          vColor.rgb *= mix(vec3(0.82, 0.95, 0.8), vec3(1.18, 1.05, 0.72), gH.b) * mix(vec3(1.0), vec3(0.95, 0.82, 1.1), step(0.86, aOff.z));`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
          float gA = aOff.z * 6.2831; float gc = cos(gA), gs = sin(gA);
          vec3 gP = vec3(position.x * gc + position.z * gs, position.y, -position.x * gs + position.z * gc) * gSc;
          float gSw = sin(uTime * (1.4 + uWind) + gW.x * 0.35 + gW.y * 0.27) + sin(uTime * 2.3 + gW.x * 0.9) * 0.4;
          gP.x += gSw * gP.y * (0.12 + uWind * 0.22); gP.z += gSw * gP.y * 0.07;
          vec3 transformed = vec3(gW.x + gP.x, gH.r + gP.y, gW.y + gP.z);`);
      // blades are lit like the ground beneath them (no back-face normal flip)
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;');
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.receiveShadow = true;
    this.grassMat = mat;
    this.group.add(mesh);
  }

  private batchFor(n: NodeDef): Batch | undefined {
    if (n.kind === 'tree') return this.trees[n.variant];
    if (n.kind === 'rock') return this.rocks[n.variant];
    return this.simple.get(n.kind);
  }

  setDepleted(id: number, dep: boolean) {
    const n = this.world.nodes[id]; if (!n) return;
    if (dep) this.depleted.add(id); else this.depleted.delete(id);
    const i = this.slot[id];
    if (n.kind === 'berry') { this.berryFruit.show(i, !dep); return; }
    if (n.kind === 'crate') { this.crateLid.show(i, !dep); return; }
    this.batchFor(n)?.show(i, !dep);
    if (n.kind === 'tree') this.stumps.show(this.stumpIdx[id], dep);
    if (n.kind === 'rock') this.rubble.show(this.rubbleIdx[id], dep);
  }

  shake(id: number) { if (!this.depleted.has(id)) this.shakes.push({ id, t: 0 }); }

  update(dt: number, time: number, cam: THREE.Vector3, wind: number) {
    this.grassUniforms.uCam.value.copy(cam);
    this.grassUniforms.uTime.value = time;
    this.grassUniforms.uWind.value = wind;
    for (let k = this.shakes.length - 1; k >= 0; k--) {
      const s = this.shakes[k];
      s.t += dt;
      const n = this.world.nodes[s.id], b = this.batchFor(n);
      if (!b || this.depleted.has(s.id)) { this.shakes.splice(k, 1); continue; }
      const i = this.slot[s.id];
      if (s.t >= 0.3) { b.setMatrix(i, b.base(i)); this.shakes.splice(k, 1); continue; }
      const a = Math.sin(s.t * 60) * 0.035 * (1 - s.t / 0.3);
      this.m.copy(b.base(i)).multiply(this.r.makeRotationZ(a));
      b.setMatrix(i, this.m);
    }
  }
  private m = new THREE.Matrix4();
  private r = new THREE.Matrix4();
}
