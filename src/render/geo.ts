// Helpers for building vertex-coloured low-poly geometry.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

export function TRS(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}

let seed = 12345;
function rnd() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }

/** Flat-shaded, vertex-coloured copy of a geometry; `jitter` varies brightness per face. */
export function part(g: THREE.BufferGeometry, color: number, m?: THREE.Matrix4, jitter = 0.06, topColor?: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g.clone();
  if (m) geo.applyMatrix4(m);
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  geo.computeBoundingBox();
  const y0 = geo.boundingBox!.min.y, y1 = geo.boundingBox!.max.y;
  const top = topColor !== undefined ? new THREE.Color(topColor) : null;
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (rnd() * 2 - 1) * jitter;
    for (let j = 0; j < 3 && i + j < n; j++) {
      _c.set(color);
      if (top) _c.lerp(top, (pos.getY(i + j) - y0) / Math.max(0.001, y1 - y0));
      col[(i + j) * 3] = _c.r * k; col[(i + j) * 3 + 1] = _c.g * k; col[(i + j) * 3 + 2] = _c.b * k;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

export const box = (sx: number, sy: number, sz: number) => new THREE.BoxGeometry(sx, sy, sz);
export const cyl = (rt: number, rb: number, h: number, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg);
export const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d);

/** Randomly displaces vertices of a (pre-merge) geometry so rocks and blobs look hand-cut. */
export function lumpy(g: THREE.BufferGeometry, amt: number, s = 1): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const map = new Map<string, [number, number, number]>();
  let local = s * 7919;
  const r = () => { local = (Math.imul(local, 1664525) + 1013904223) >>> 0; return local / 4294967296 - 0.5; };
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = map.get(key);
    if (!d) map.set(key, (d = [r() * amt, r() * amt, r() * amt]));
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  return g;
}

export const flatMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Instanced objects split into spatial chunks so the frustum can cull whole regions. */
export interface BatchItem { x: number; y: number; z: number; rot: number; scale: number; sy?: number; color?: number }

export class Batch {
  meshes: THREE.InstancedMesh[] = [];
  private where: [THREE.InstancedMesh, number][] = [];
  private mats: THREE.Matrix4[] = [];
  private static zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, items: BatchItem[], o: { cast?: boolean; receive?: boolean; chunk?: number; hidden?: boolean } = {}) {
    const chunk = o.chunk ?? 128;
    const groups = new Map<string, number[]>();
    items.forEach((it, i) => {
      const k = `${Math.floor(it.x / chunk)},${Math.floor(it.z / chunk)}`;
      let a = groups.get(k); if (!a) groups.set(k, (a = []));
      a.push(i);
    });
    const col = new THREE.Color();
    for (const idx of groups.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, idx.length);
      idx.forEach((i, j) => {
        const it = items[i];
        const m = TRS(it.x, it.y, it.z, 0, it.rot, 0, it.scale, it.sy ?? it.scale, it.scale);
        this.mats[i] = m;
        this.where[i] = [mesh, j];
        mesh.setMatrixAt(j, o.hidden ? Batch.zero : m);
        if (it.color !== undefined) mesh.setColorAt(j, col.set(it.color));
      });
      mesh.castShadow = !!o.cast; mesh.receiveShadow = o.receive ?? true;
      mesh.instanceMatrix.needsUpdate = true;
      // bounding sphere from full-size matrices so hidden instances can be re-shown safely
      idx.forEach((i, j) => mesh.setMatrixAt(j, this.mats[i]));
      mesh.computeBoundingSphere();
      if (o.hidden) idx.forEach((_i, j) => mesh.setMatrixAt(j, Batch.zero));
      parent.add(mesh);
      this.meshes.push(mesh);
    }
  }
  show(i: number, visible: boolean) {
    const w = this.where[i]; if (!w) return;
    w[0].setMatrixAt(w[1], visible ? this.mats[i] : Batch.zero);
    w[0].instanceMatrix.needsUpdate = true;
  }
  setMatrix(i: number, m: THREE.Matrix4) {
    const w = this.where[i]; if (!w) return;
    w[0].setMatrixAt(w[1], m);
    w[0].instanceMatrix.needsUpdate = true;
  }
  base(i: number) { return this.mats[i]; }
}
