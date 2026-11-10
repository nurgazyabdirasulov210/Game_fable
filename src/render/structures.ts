// Static structures (data-driven boxes from the shared world) and hand-built low-poly props.
import * as THREE from 'three';
import type { World, Prop } from '../../shared/world';
import { box, cone, cyl, flatMat, ico, lumpy, merge, part, TRS } from './geo';

const MAT: Record<string, number> = {
  wood: 0x8a5a36, plank: 0xa87a4a, oldwood: 0x7d6a58, concrete: 0xa9a79c, metal: 0x6d7d86,
  roof: 0x8a4032, roofflat: 0x4c4c54, floor: 0x8c7b66, fence: 0x5b626c,
};

export function gableGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const A = [-w / 2, 0, -d / 2], B = [w / 2, 0, -d / 2], C = [w / 2, 0, d / 2], D = [-w / 2, 0, d / 2], E = [-w / 2, h, 0], F = [w / 2, h, 0];
  const tris = [D, C, F, D, F, E, B, A, E, B, E, F, A, D, E, C, B, F, A, B, C, A, C, D];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  g.computeVertexNormals();
  return g;
}

function propGeo(p: Prop): THREE.BufferGeometry | null {
  switch (p.type) {
    case 'tent': {
      const parts = [
        part(gableGeo(3.4, 1.75, 2.6), 0x2f6fb5, undefined, 0.05),
        part(gableGeo(0.5, 1.79, 2.66), 0xe8823a, TRS(-1.0, 0, 0), 0.03),
        part(gableGeo(0.5, 1.79, 2.66), 0xe8823a, TRS(1.0, 0, 0), 0.03),
        part(gableGeo(0.06, 1.3, 1.5), 0x1b2c44, TRS(1.71, 0, 0), 0),
        part(box(3.5, 0.06, 2.8), 0x39424e, TRS(0, 0.03, 0)),
      ];
      return merge(parts);
    }
    case 'firepit': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283; parts.push(part(lumpy(ico(0.2, 0), 0.07, i + 1), 0x6a6a7c, TRS(Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.62, 0, a, 0, 1, 0.8, 1), 0.1)); }
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.283 + 0.4; parts.push(part(cyl(0.06, 0.08, 0.9, 5), 0x4a2f20, TRS(Math.cos(a) * 0.18, 0.3, Math.sin(a) * 0.18, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6))); }
      parts.push(part(cyl(0.5, 0.5, 0.05, 8), 0x2a2422, TRS(0, 0.03, 0)));
      return merge(parts);
    }
    case 'log': return merge([part(cyl(0.27, 0.3, 2.1, 7), 0x8a5a36, TRS(0, 0.28, 0, 0, 0, Math.PI / 2)), part(cyl(0.24, 0.24, 2.12, 7), 0xd2a76e, TRS(0, 0.28, 0, 0, 0, Math.PI / 2, 0.9, 1, 0.9), 0.02)]);
    case 'barrel': return merge([part(cyl(0.4, 0.4, 1.1, 8), 0x9a4a32, TRS(0, 0.55, 0), 0.07), part(cyl(0.42, 0.42, 0.08, 8), 0x54382e, TRS(0, 0.2, 0)), part(cyl(0.42, 0.42, 0.08, 8), 0x54382e, TRS(0, 0.9, 0))]);
    case 'lantern': return merge([part(cyl(0.05, 0.07, 2.4, 5), 0x4a3a2c, TRS(0, 1.2, 0)), part(box(0.5, 0.06, 0.06), 0x4a3a2c, TRS(0.2, 2.3, 0)), part(box(0.2, 0.28, 0.2), 0x2c2c30, TRS(0.4, 2.1, 0))]);
    case 'radio': return merge([
      part(box(1.7, 0.9, 0.75), 0x4d5a62, TRS(0, 0.45, 0), 0.04),
      part(box(1.6, 0.7, 0.3), 0x39444b, TRS(0, 1.25, -0.2, -0.15), 0.04),
      part(box(0.5, 0.36, 0.05), 0x14181b, TRS(-0.45, 1.3, -0.02, -0.15)),
      part(cyl(0.16, 0.16, 0.05, 8), 0x1b1f22, TRS(0.45, 1.3, -0.04, Math.PI / 2 - 0.15)),
      part(box(0.08, 0.05, 0.08), 0xc9c2a8, TRS(0.1, 0.93, 0.2)), part(box(0.08, 0.05, 0.08), 0xc9c2a8, TRS(0.3, 0.93, 0.2)), part(box(0.08, 0.05, 0.08), 0xb5553c, TRS(0.5, 0.93, 0.2)),
      part(cyl(0.012, 0.012, 1.1, 4), 0xbfc5c9, TRS(0.75, 2.1, -0.25)),
      part(box(0.3, 0.14, 0.2), 0x22272b, TRS(-0.5, 0.97, 0.15)),
    ]);
    case 'desk': return merge([part(box(1.7, 0.08, 0.8), 0x8a6a4a, TRS(0, 0.78, 0)), part(box(0.08, 0.78, 0.7), 0x4d5a62, TRS(-0.78, 0.39, 0)), part(box(0.08, 0.78, 0.7), 0x4d5a62, TRS(0.78, 0.39, 0)), part(box(0.55, 0.4, 0.06), 0x1c2226, TRS(0.2, 1.1, -0.15)), part(box(0.1, 0.12, 0.1), 0x1c2226, TRS(0.2, 0.86, -0.15)), part(box(0.3, 0.02, 0.22), 0xd9d4c2, TRS(-0.4, 0.83, 0.1, 0, 0.3))]);
    case 'shelf': return merge([part(box(1.3, 1.9, 0.08), 0x59666e, TRS(0, 0.95, -0.2)), part(box(1.3, 0.06, 0.45), 0x6d7d86, TRS(0, 0.4, 0)), part(box(1.3, 0.06, 0.45), 0x6d7d86, TRS(0, 1.0, 0)), part(box(1.3, 0.06, 0.45), 0x6d7d86, TRS(0, 1.6, 0)), part(box(0.3, 0.3, 0.3), 0xa9743f, TRS(-0.3, 0.58, 0)), part(box(0.22, 0.34, 0.22), 0x3b6a8a, TRS(0.3, 1.2, 0)), part(cyl(0.1, 0.1, 0.25, 6), 0x9a4a32, TRS(-0.2, 1.75, 0))]);
    case 'dish': return merge([part(cyl(0.06, 0.1, 1.2, 5), 0x7d8a92, TRS(0, 0.6, 0)), part(new THREE.ConeGeometry(1.2, 0.5, 10, 1, true), 0xd4d8da, TRS(0, 1.55, 0.25, -Math.PI / 2 - 0.7), 0.04), part(cyl(0.02, 0.02, 0.8, 4), 0x7d8a92, TRS(0, 1.75, 0.5, 0.85))]);
    case 'antenna': {
      const parts: THREE.BufferGeometry[] = [];
      const H = 20;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(part(cyl(0.05, 0.09, H, 4), 0xb5553c, TRS(sx * 0.42, H / 2, sz * 0.42, sz * 0.03, 0, -sx * 0.03), 0.05));
      for (let y = 2; y < H; y += 2.4) { const w = 0.95 * (1 - y / H) * 1.25 + 0.1; parts.push(part(box(w * 2, 0.06, 0.06), 0xd9d4c2, TRS(0, y, w)), part(box(w * 2, 0.06, 0.06), 0xd9d4c2, TRS(0, y, -w)), part(box(0.06, 0.06, w * 2), 0xd9d4c2, TRS(w, y, 0)), part(box(0.06, 0.06, w * 2), 0xd9d4c2, TRS(-w, y, 0))); }
      parts.push(part(cyl(0.02, 0.04, 3, 4), 0xbfc5c9, TRS(0, H + 1.5, 0)), part(box(1.4, 1.0, 1.4), 0x7d7d76, TRS(0, 0.25, 0)));
      return merge(parts);
    }
    case 'generator': return merge([part(box(1.6, 0.9, 0.9), 0x8a8f3a, TRS(0, 0.6, 0), 0.05), part(box(1.7, 0.14, 1.0), 0x2d3135, TRS(0, 0.1, 0)), part(cyl(0.07, 0.07, 0.6, 5), 0x2d3135, TRS(0.5, 1.3, 0.2)), part(box(0.4, 0.3, 0.05), 0x1c2226, TRS(-0.3, 0.7, 0.46))]);
    case 'car': {
      const parts = [part(box(4.0, 0.75, 1.7), 0x8a4a32, TRS(0, 0.72, 0), 0.08), part(box(2.0, 0.65, 1.55), 0x74412f, TRS(-0.3, 1.4, 0), 0.08), part(box(1.9, 0.45, 1.6), 0x1f2a30, TRS(-0.3, 1.42, 0), 0.02), part(box(0.2, 0.2, 1.8), 0x555a5e, TRS(2.0, 0.5, 0)), part(box(0.2, 0.2, 1.8), 0x555a5e, TRS(-2.0, 0.5, 0))];
      for (const [x, z] of [[1.3, 0.85], [-1.3, 0.85], [1.3, -0.85], [-1.3, -0.85]]) parts.push(part(cyl(0.36, 0.36, 0.25, 8), 0x1a1a1c, TRS(x, 0.34, z, Math.PI / 2)));
      return merge(parts);
    }
    case 'well': {
      const parts: THREE.BufferGeometry[] = [part(cyl(1.0, 1.1, 0.9, 9), 0x77768a, TRS(0, 0.45, 0), 0.1), part(cyl(0.75, 0.75, 0.92, 9), 0x14202a, TRS(0, 0.46, 0), 0)];
      parts.push(part(box(0.14, 2.2, 0.14), 0x7d6a58, TRS(-0.9, 1.1, 0)), part(box(0.14, 2.2, 0.14), 0x7d6a58, TRS(0.9, 1.1, 0)), part(gableGeo(2.4, 0.6, 1.6), 0x8a4032, TRS(0, 2.2, 0)), part(cyl(0.06, 0.06, 1.8, 5), 0x5a4a3c, TRS(0, 1.8, 0, 0, 0, Math.PI / 2)));
      return merge(parts);
    }
    case 'ladder': {
      const H = (p.top ?? p.y + 9) - p.y + 0.9;
      const parts = [part(box(0.08, H, 0.08), 0x8a5a36, TRS(-0.3, H / 2, 0, 0.06)), part(box(0.08, H, 0.08), 0x8a5a36, TRS(0.3, H / 2, 0, 0.06))];
      for (let y = 0.35; y < H - 0.2; y += 0.42) parts.push(part(box(0.6, 0.06, 0.06), 0xa87a4a, TRS(0, y, -(y - H / 2) * 0.06)));
      return merge(parts);
    }
  }
  return null;
}

export class Structures {
  group = new THREE.Group();
  radioLight: THREE.Mesh;
  beacon: THREE.Mesh;
  /** permanent light / fire emitters contributed by props */
  fires: THREE.Vector3[] = [];
  lanterns: THREE.Vector3[] = [];

  constructor(world: World, scene: THREE.Scene) {
    scene.add(this.group);
    const geos: THREE.BufferGeometry[] = [];
    for (const b of world.boxes) {
      const g = b.shape === 'gable' ? gableGeo(b.sx, b.sy, b.sz) : box(b.sx, b.sy, b.sz);
      const y = b.shape === 'gable' ? b.y : b.y + b.sy / 2;
      geos.push(part(g, MAT[b.mat] ?? 0x888888, TRS(b.x, y, b.z, 0, b.rot, 0), b.mat === 'concrete' ? 0.035 : 0.08));
      // plank lines on wooden bridge / floors are suggested by per-face jitter only
    }
    for (const p of world.props) {
      const g = propGeo(p);
      if (g) { g.applyMatrix4(TRS(p.x, p.y, p.z, 0, p.rot, 0, p.scale)); geos.push(g); }
      if (p.type === 'firepit') this.fires.push(new THREE.Vector3(p.x, p.y, p.z));
      if (p.type === 'lantern') this.lanterns.push(new THREE.Vector3(p.x, p.y + 2.1, p.z).add(new THREE.Vector3(0.4, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.rot)));
    }
    const mat = flatMat();
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(merge(geos), mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);

    const radio = world.props.find((p) => p.type === 'radio')!;
    this.radioLight = new THREE.Mesh(box(0.42, 0.28, 0.02), new THREE.MeshBasicMaterial({ color: 0x551111 }));
    this.radioLight.position.set(-0.45, 1.3, 0.02).applyAxisAngle(new THREE.Vector3(0, 1, 0), radio.rot).add(new THREE.Vector3(radio.x, radio.y, radio.z));
    this.radioLight.rotation.set(-0.15, radio.rot, 0, 'YXZ');
    this.group.add(this.radioLight);
    const ant = world.props.find((p) => p.type === 'antenna')!;
    this.beacon = new THREE.Mesh(ico(0.28, 0), new THREE.MeshBasicMaterial({ color: 0x330000, fog: false }));
    this.beacon.position.set(ant.x, ant.y + 23.1, ant.z);
    this.group.add(this.beacon);
    for (const l of this.lanterns) {
      const glow = new THREE.Mesh(box(0.14, 0.2, 0.14), new THREE.MeshBasicMaterial({ color: 0xffc46a }));
      glow.position.copy(l); this.group.add(glow);
    }
  }

  setRadio(state: 'broken' | 'ready' | 'tx' | 'done', t: number) {
    const m = this.radioLight.material as THREE.MeshBasicMaterial, b = this.beacon.material as THREE.MeshBasicMaterial;
    if (state === 'broken') { m.color.set(0x3a0d0d); b.color.set(0x220000); }
    else if (state === 'ready') { m.color.set(0xd9a03a); b.color.set(0x220000); }
    else if (state === 'tx') { const k = Math.sin(t * 8) > 0 ? 1 : 0.25; m.color.setRGB(0.2 * k, 1 * k, 0.4 * k); b.color.setRGB(Math.sin(t * 5) > 0 ? 1 : 0.1, 0.05, 0.05); }
    else { m.color.set(0x3dff7a); b.color.setRGB(Math.sin(t * 2) > 0 ? 1 : 0.15, 0.05, 0.05); }
  }
}
