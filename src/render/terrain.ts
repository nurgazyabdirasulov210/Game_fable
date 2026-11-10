import * as THREE from 'three';
import { fbm, smoothstep } from '../../shared/rng';
import { CELL, GRID_N, WORLD_HALF, World } from '../../shared/world';

const C = (h: number) => new THREE.Color(h);
const PAL = {
  grassA: C(0x7c9a45), grassB: C(0x5f8a3e), grassC: C(0x9aa24d), lilac: C(0x8b7fa0),
  dirt: C(0xa5673c), sand: C(0xc9b27a), rock: C(0x6c6a85), rockHi: C(0x8a8798), snow: C(0xe9eef5),
  bed: C(0x4a5a52), sick: C(0x8a8a58), yard: C(0x8f8a70),
};

/** Ground colour (linear) + grass density at a world position. */
export function groundColor(w: World, x: number, z: number, out: THREE.Color): number {
  const h = w.heightAt(x, z);
  const slope = w.slopeAt(x, z);
  const n1 = fbm(x * 0.02, z * 0.02, 3, 77), n2 = fbm(x * 0.09 + 30, z * 0.09, 2, 78);
  out.copy(PAL.grassA).lerp(PAL.grassB, smoothstep(0.35, 0.65, n1)).lerp(PAL.grassC, smoothstep(0.55, 0.8, n2) * 0.7);
  out.lerp(PAL.lilac, smoothstep(0.62, 0.8, fbm(x * 0.035 + 200, z * 0.035, 2, 79)) * 0.45);
  let grass = 0.55 + n2 * 0.6;
  const zone = w.zoneAt(x, z);
  if (zone?.kind === 'radiation') { const k = smoothstep(zone.r, zone.r * 0.6, Math.hypot(x - zone.x, z - zone.z)); out.lerp(PAL.sick, k * 0.75); grass *= 1 - k * 0.6; }
  const pd = w.pathDist(x, z);
  const pk = smoothstep(3.4, 1.4, pd + (n2 - 0.5) * 1.6);
  out.lerp(PAL.dirt, pk); grass *= 1 - smoothstep(4, 2, pd);
  for (const p of w.pois) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r) { const k = smoothstep(p.r, p.r * 0.55, d); out.lerp(p.id === 'station' ? PAL.yard : PAL.dirt, k * 0.8); grass *= 1 - k; }
  }
  const sandK = smoothstep(1.1, 0.35, h);
  out.lerp(PAL.sand, sandK); grass *= 1 - smoothstep(1.3, 0.7, h) ;
  if (h < 0) out.lerp(PAL.bed, smoothstep(0, -1.5, h));
  const rk = smoothstep(0.62, 0.95, slope + (n2 - 0.5) * 0.2) * smoothstep(1.5, 4, h);
  out.lerp(n1 > 0.5 ? PAL.rock : PAL.rockHi, rk); grass *= 1 - smoothstep(0.55, 0.8, slope);
  const hi = smoothstep(42, 60, h + n1 * 10);
  out.lerp(PAL.rock, hi * 0.8); grass *= 1 - hi;
  out.lerp(PAL.snow, smoothstep(78, 96, h + n2 * 14));
  return Math.max(0, Math.min(1, grass));
}

export interface TerrainView { mesh: THREE.Mesh; water: THREE.Mesh; heightTex: THREE.DataTexture; waterMat: THREE.MeshStandardMaterial }

export function buildTerrain(world: World, scene: THREE.Scene, floatLinear: boolean): TerrainView {
  const N = GRID_N;
  const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
  const tex = new Float32Array(N * N * 4);
  const c = new THREE.Color();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = i * CELL - WORLD_HALF, z = j * CELL - WORLD_HALF;
    const h = world.heights[k];
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    const g = groundColor(world, x, z, c);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    tex[k * 4] = h; tex[k * 4 + 1] = g; tex[k * 4 + 2] = fbm(x * 0.05, z * 0.05, 2, 91); tex[k * 4 + 3] = 1;
  }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let q = 0;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, d = a + N, e = d + 1;
    idx[q++] = a; idx[q++] = d; idx[q++] = b;
    idx[q++] = b; idx[q++] = d; idx[q++] = e;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);

  const heightTex = new THREE.DataTexture(tex, N, N, THREE.RGBAFormat, THREE.FloatType);
  heightTex.minFilter = heightTex.magFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;

  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f7f8c, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.8 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2.4, WORLD_HALF * 2.4, 1, 1).rotateX(-Math.PI / 2), waterMat);
  water.position.y = -0.12;
  water.renderOrder = 1;
  scene.add(water);
  return { mesh, water, heightTex, waterMat };
}

/** Top-down map image used by the minimap and the full map. */
export function renderMapImage(world: World, size = 384): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const c = new THREE.Color(), water = new THREE.Color(0x3d8f9c), deep = new THREE.Color(0x2a6a7c);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i / size) * 2 * WORLD_HALF - WORLD_HALF, z = (j / size) * 2 * WORLD_HALF - WORLD_HALF;
    const h = world.heightAt(x, z);
    groundColor(world, x, z, c);
    if (h < -0.1) c.copy(water).lerp(deep, smoothstep(-0.3, -3, h));
    else {
      const shade = 1 + (world.heightAt(x - 3, z - 3) - world.heightAt(x + 3, z + 3)) * 0.035;
      c.multiplyScalar(Math.max(0.55, Math.min(1.4, shade)));
    }
    c.convertLinearToSRGB();
    const k = (j * size + i) * 4;
    img.data[k] = c.r * 255; img.data[k + 1] = c.g * 255; img.data[k + 2] = c.b * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // forests as darker speckles
  ctx.fillStyle = 'rgba(24,60,44,0.55)';
  const s = size / (2 * WORLD_HALF);
  for (const n of world.nodes) if (n.kind === 'tree') ctx.fillRect((n.x + WORLD_HALF) * s - 1, (n.z + WORLD_HALF) * s - 1, 2.2, 2.2);
  ctx.fillStyle = 'rgba(40,34,30,0.9)';
  for (const b of world.boxes) if (b.mat === 'roof' || b.mat === 'roofflat') {
    ctx.save(); ctx.translate((b.x + WORLD_HALF) * s, (b.z + WORLD_HALF) * s); ctx.rotate(-b.rot);
    ctx.fillRect((-b.sx / 2) * s, (-b.sz / 2) * s, b.sx * s, b.sz * s); ctx.restore();
  }
  return cv;
}
