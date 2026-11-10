// Player-built pieces: meshes, placement ghost, fire and smoke effects, pooled point lights.
import * as THREE from 'three';
import type { BuildType } from '../../shared/items';
import type { BuildingNet } from '../../shared/room';
import { box, cone, cyl, flatMat, ico, lumpy, merge, part, TRS } from './geo';

const cache = new Map<string, THREE.BufferGeometry>();
function geoFor(type: BuildType | 'doorPanel' | 'chestLid'): THREE.BufferGeometry {
  let g = cache.get(type);
  if (g) return g;
  const wood = 0xa87a4a, dark = 0x7a5232;
  switch (type) {
    case 'foundation': {
      const parts = [part(box(4, 3.6, 4), 0x77768a, TRS(0, -2.0, 0), 0.08), part(box(4.06, 0.12, 4.06), dark, TRS(0, -0.2, 0))];
      for (let i = 0; i < 5; i++) parts.push(part(box(0.78, 0.2, 4.02), wood, TRS(-1.6 + i * 0.8, -0.1, 0), 0.09));
      g = merge(parts); break;
    }
    case 'wall': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i++) parts.push(part(box(0.49, 2.9, 0.14), wood, TRS(-1.75 + i * 0.5, 1.5, 0), 0.1));
      parts.push(part(box(4, 0.18, 0.24), dark, TRS(0, 0.12, 0)), part(box(4, 0.18, 0.24), dark, TRS(0, 2.9, 0)), part(box(0.16, 3, 0.26), dark, TRS(-1.92, 1.5, 0)), part(box(0.16, 3, 0.26), dark, TRS(1.92, 1.5, 0)));
      g = merge(parts); break;
    }
    case 'door': {
      const parts: THREE.BufferGeometry[] = [];
      for (const s of [-1, 1]) { for (let i = 0; i < 2; i++) parts.push(part(box(0.5, 2.9, 0.14), wood, TRS(s * (1.0 + i * 0.52), 1.5, 0), 0.1)); parts.push(part(box(0.16, 3, 0.26), dark, TRS(s * 0.76, 1.5, 0)), part(box(0.16, 3, 0.26), dark, TRS(s * 1.92, 1.5, 0))); }
      parts.push(part(box(4, 0.6, 0.2), wood, TRS(0, 2.68, 0), 0.08), part(box(4, 0.18, 0.24), dark, TRS(0, 2.9, 0)), part(box(1.4, 0.1, 0.3), dark, TRS(0, 0.05, 0)));
      g = merge(parts); break;
    }
    case 'doorPanel': g = merge([part(box(1.36, 2.3, 0.1), 0xb98a52, TRS(0.68, 1.22, 0), 0.08), part(box(1.36, 0.12, 0.13), dark, TRS(0.68, 0.5, 0)), part(box(1.36, 0.12, 0.13), dark, TRS(0.68, 1.9, 0)), part(box(0.06, 0.16, 0.2), 0x2f2f36, TRS(1.2, 1.2, 0))]); break;
    case 'campfire': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; parts.push(part(lumpy(ico(0.17, 0), 0.06, i + 3), 0x6a6a7c, TRS(Math.cos(a) * 0.5, 0.09, Math.sin(a) * 0.5, 0, a, 0, 1, 0.8, 1), 0.1)); }
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.283 + 0.4; parts.push(part(cyl(0.05, 0.07, 0.8, 5), 0x4a2f20, TRS(Math.cos(a) * 0.15, 0.27, Math.sin(a) * 0.15, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6))); }
      parts.push(part(cyl(0.4, 0.4, 0.04, 8), 0x2a2422, TRS(0, 0.02, 0)));
      g = merge(parts); break;
    }
    case 'chest': g = merge([part(box(1.1, 0.6, 0.7), 0xa9743f, TRS(0, 0.3, 0), 0.06), part(box(1.14, 0.08, 0.74), 0x54382e, TRS(0, 0.08, 0)), part(box(0.1, 0.62, 0.74), 0x54382e, TRS(-0.5, 0.3, 0)), part(box(0.1, 0.62, 0.74), 0x54382e, TRS(0.5, 0.3, 0))]); break;
    case 'chestLid': g = merge([part(box(1.14, 0.2, 0.74), 0xb98248, TRS(0, 0.1, 0.37), 0.05), part(box(0.16, 0.16, 0.05), 0xd9b23a, TRS(0, 0.02, 0.75))]); break;
  }
  cache.set(type, g!);
  return g!;
}

export interface BuildingView { b: BuildingNet; group: THREE.Group; door?: THREE.Group; lid?: THREE.Group; openK: number }

export class Buildings {
  group = new THREE.Group();
  views = new Map<number, BuildingView>();
  private mat = flatMat();
  ghost = new THREE.Group();
  private ghostMesh: THREE.Mesh;
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.45, depthWrite: false });

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.ghostMesh = new THREE.Mesh(geoFor('wall'), this.ghostMat);
    this.ghost.add(this.ghostMesh);
    this.ghost.visible = false;
    scene.add(this.ghost);
  }

  add(b: BuildingNet): BuildingView {
    const group = new THREE.Group();
    group.position.set(b.x, b.y, b.z); group.rotation.y = b.rot;
    const m = new THREE.Mesh(geoFor(b.type), this.mat);
    m.castShadow = b.type !== 'campfire'; m.receiveShadow = true;
    group.add(m);
    const v: BuildingView = { b, group, openK: b.open ? 1 : 0 };
    if (b.type === 'door') {
      v.door = new THREE.Group(); v.door.position.set(-0.68, 0, 0);
      const p = new THREE.Mesh(geoFor('doorPanel'), this.mat); p.castShadow = true; v.door.add(p); group.add(v.door);
    }
    if (b.type === 'chest') {
      v.lid = new THREE.Group(); v.lid.position.set(0, 0.6, -0.37);
      const p = new THREE.Mesh(geoFor('chestLid'), this.mat); p.castShadow = true; v.lid.add(p); group.add(v.lid);
    }
    this.group.add(group);
    this.views.set(b.id, v);
    return v;
  }
  remove(id: number) {
    const v = this.views.get(id); if (!v) return;
    this.group.remove(v.group); this.views.delete(id);
  }
  update(dt: number, openChest: number | null) {
    for (const v of this.views.values()) {
      if (v.door) { const t = v.b.open ? 1 : 0; v.openK += (t - v.openK) * Math.min(1, dt * 8); v.door.rotation.y = v.openK * 1.75; }
      if (v.lid) { const t = openChest === v.b.id ? 1 : 0; v.openK += (t - v.openK) * Math.min(1, dt * 8); v.lid.rotation.x = -v.openK * 1.1; }
    }
  }
  setGhost(type: BuildType | null, x = 0, y = 0, z = 0, rot = 0, ok = true) {
    if (!type) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    this.ghostMesh.geometry = geoFor(type);
    this.ghost.position.set(x, y + 0.02, z); this.ghost.rotation.y = rot;
    this.ghostMat.color.set(ok ? 0x55ff88 : 0xff4a3d);
  }
}

// ------------------------------------------------------------------ fire & light
export interface Emitter { pos: THREE.Vector3; kind: 'fire' | 'torch' | 'lantern' }

export class FireFx {
  private flames: THREE.InstancedMesh;
  private smoke: THREE.InstancedMesh;
  private lights: THREE.PointLight[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private static MAX_FIRES = 10;
  private static PUFFS = 7;
  nearestFire = Infinity;

  constructor(scene: THREE.Scene, lightCount: number) {
    const fg = merge([part(cone(0.3, 0.9, 5), 0xff7a1a, TRS(0, 0.45, 0), 0, 0xffd34a), part(cone(0.18, 0.6, 4), 0xffc23a, TRS(0.05, 0.4, 0.04), 0, 0xfff3b0)]);
    this.flames = new THREE.InstancedMesh(fg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), FireFx.MAX_FIRES * 3);
    this.flames.frustumCulled = false; this.flames.count = 0;
    scene.add(this.flames);
    const sg = lumpy(ico(1, 1), 0.3, 77); sg.computeVertexNormals();
    this.smoke = new THREE.InstancedMesh(sg, new THREE.MeshLambertMaterial({ color: 0xb9bcc4, flatShading: true, transparent: true, opacity: 0.32, depthWrite: false }), FireFx.MAX_FIRES * FireFx.PUFFS);
    this.smoke.frustumCulled = false; this.smoke.count = 0; this.smoke.renderOrder = 3;
    scene.add(this.smoke);
    for (let i = 0; i < lightCount; i++) { const l = new THREE.PointLight(0xff9a45, 0, 26, 1.6); this.lights.push(l); scene.add(l); }
  }

  update(time: number, emitters: Emitter[], focus: THREE.Vector3, rain: number) {
    emitters.sort((a, b) => a.pos.distanceToSquared(focus) - b.pos.distanceToSquared(focus));
    let fi = 0, si = 0, li = 0, fires = 0;
    this.nearestFire = Infinity;
    for (const e of emitters) {
      const d = e.pos.distanceTo(focus);
      if (e.kind === 'fire') this.nearestFire = Math.min(this.nearestFire, d);
      if (li < this.lights.length && d < 90) {
        const l = this.lights[li++];
        const fl = 1 + Math.sin(time * 11 + li * 3) * 0.12 + Math.sin(time * 23.7 + li) * 0.08;
        l.position.copy(e.pos); l.position.y += e.kind === 'fire' ? 1.0 : 0.6;
        l.color.set(e.kind === 'lantern' ? 0xffd08a : e.kind === 'torch' ? 0xffb878 : 0xffa058);
        l.intensity = (e.kind === 'fire' ? 30 : e.kind === 'torch' ? 15 : 10) * fl;
        l.distance = e.kind === 'fire' ? 30 : e.kind === 'torch' ? 26 : 16;
      }
      if (e.kind !== 'fire' || fires >= FireFx.MAX_FIRES || d > 130) continue;
      fires++;
      const seed = e.pos.x * 12.9 + e.pos.z * 78.2;
      for (let k = 0; k < 3; k++) {
        const f = 0.8 + Math.sin(time * (9 + k * 3) + seed + k * 2) * 0.22;
        this.s.set(f * (1 - k * 0.2), (0.9 + Math.sin(time * (13 + k * 2) + seed) * 0.3) * (1 - k * 0.15), f * (1 - k * 0.2));
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, time * (1.5 + k) + k * 2);
        this.v.set(e.pos.x + Math.sin(k * 2.1 + seed) * 0.14, e.pos.y + 0.12, e.pos.z + Math.cos(k * 2.1 + seed) * 0.14);
        this.flames.setMatrixAt(fi++, this.m.compose(this.v, this.q, this.s));
      }
      for (let k = 0; k < FireFx.PUFFS; k++) {
        const t = ((time * 0.16 + k / FireFx.PUFFS + seed * 0.01) % 1 + 1) % 1;
        const sc = (0.25 + t * 1.5) * (1 - Math.max(0, t - 0.75) * 4 * 0.999);
        this.v.set(e.pos.x + Math.sin(t * 5 + k * 1.7 + seed) * 0.5 * t + t * 2.2, e.pos.y + 1.0 + t * 9, e.pos.z + Math.cos(t * 4 + k * 2.3) * 0.5 * t);
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t * 3 + k);
        this.flames.count; // keep type-checker quiet about unused chains
        this.smoke.setMatrixAt(si++, this.m.compose(this.v, this.q, this.s.setScalar(Math.max(0.001, sc * (1 - rain * 0.4)))));
      }
    }
    for (; li < this.lights.length; li++) this.lights[li].intensity = 0;
    this.flames.count = fi; this.smoke.count = si;
    this.flames.instanceMatrix.needsUpdate = true; this.smoke.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ weather + hit particles
export class WeatherFx {
  private rain: THREE.LineSegments;
  private rainMat: THREE.ShaderMaterial;
  private bolt: THREE.Line;
  private boltT = 0;
  private nextBolt = 6;
  onThunder: (dist: number) => void = () => {};
  flashRequest = 0;

  constructor(private scene: THREE.Scene) {
    const N = 2600, pos = new Float32Array(N * 6), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 50 - 25, y = Math.random() * 34, z = Math.random() * 50 - 25, r = Math.random();
      pos.set([x, y, z, x, y, z], i * 6); seed.set([0, 1], i * 2);
      void r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(seed, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uK: { value: 0 }, uWind: { value: 0 }, uColor: { value: new THREE.Color(0xa9c4dc) } },
      vertexShader: `attribute float aEnd; uniform vec3 uCam; uniform float uTime; uniform float uK; uniform float uWind; varying float vA;
        void main(){ vec3 p = position; float sp = 26.0 + fract(p.x * 12.3 + p.z * 7.7) * 10.0;
          p.y = mod(p.y - uTime * sp, 34.0);
          p.x += uWind * (34.0 - p.y) * -0.12;
          p.xz = mod(p.xz - uCam.xz + 25.0, 50.0) - 25.0;
          p.y += aEnd * 0.9; p.x += aEnd * uWind * 0.11;
          vec3 w = vec3(uCam.x + p.x, uCam.y - 12.0 + p.y, uCam.z + p.z);
          vA = step(fract(position.x * 3.7 + position.z * 1.3), uK) * 0.42;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(uColor, vA); }',
    });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false; this.rain.visible = false; this.rain.renderOrder = 4;
    scene.add(this.rain);
    this.bolt = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3)), new THREE.LineBasicMaterial({ color: 0xeaf2ff, fog: false }));
    this.bolt.frustumCulled = false; this.bolt.visible = false;
    scene.add(this.bolt);
  }

  update(dt: number, time: number, cam: THREE.Vector3, rain: number, wind: number, storm: boolean, dayF: number) {
    this.rain.visible = rain > 0.02;
    const U = this.rainMat.uniforms;
    U.uCam.value.copy(cam); U.uTime.value = time; U.uK.value = rain; U.uWind.value = wind * 6;
    U.uColor.value.setScalar(0.35 + dayF * 0.5);
    if (this.boltT > 0) { this.boltT -= dt; if (this.boltT <= 0) this.bolt.visible = false; }
    if (storm && rain > 0.7) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 5 + Math.random() * 11;
        const a = Math.random() * 6.283, d = 90 + Math.random() * 260;
        const p = this.bolt.geometry.getAttribute('position') as THREE.BufferAttribute;
        let x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
        for (let i = 0; i < 14; i++) { p.setXYZ(i, x, 190 - i * 14.5, z); x += (Math.random() - 0.5) * 16; z += (Math.random() - 0.5) * 16; }
        p.needsUpdate = true;
        this.bolt.visible = true; this.boltT = 0.16;
        this.flashRequest = 1;
        this.onThunder(Math.min(1, d / 350));
      }
    }
  }
}

export class Particles {
  private pts: THREE.Points;
  private pos: Float32Array; private vel: Float32Array; private life: Float32Array; private col: Float32Array;
  private n = 260; private cur = 0;
  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.n * 3); this.vel = new Float32Array(this.n * 3); this.life = new Float32Array(this.n); this.col = new Float32Array(this.n * 3);
    this.pos.fill(-9999);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, sizeAttenuation: true }));
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }
  burst(x: number, y: number, z: number, color: number, count = 10, speed = 3.2) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const k = this.cur = (this.cur + 1) % this.n;
      this.pos.set([x, y, z], k * 3);
      this.vel.set([(Math.random() - 0.5) * speed, Math.random() * speed * 0.9 + 1, (Math.random() - 0.5) * speed], k * 3);
      const j = 0.75 + Math.random() * 0.5;
      this.col.set([c.r * j, c.g * j, c.b * j], k * 3);
      this.life[k] = 0.5 + Math.random() * 0.4;
    }
    (this.pts.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
  update(dt: number) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -9999; continue; }
      this.vel[k * 3 + 1] -= 12 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
    }
    (this.pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
