// Sky dome, sun/moon, stars, clouds, fog and scene lighting driven by time of day and weather.
import * as THREE from 'three';
import { clamp, lerp, mulberry32, smoothstep } from '../../shared/rng';
import type { WeatherType } from '../../shared/room';
import { ico, lumpy, merge, part, TRS } from './geo';

const col = (h: number) => new THREE.Color(h);
const K = {
  nightTop: col(0x050912), nightHor: col(0x0e1830), dayTop: col(0x3f86d8), dayHor: col(0xb9dcea),
  dusk: col(0xf28b4a), duskTop: col(0x4a3f78), greyDay: col(0x7f8b96), greyNight: col(0x07090e),
  sunWarm: col(0xffb070), sunWhite: col(0xfff3dc), moon: col(0x7f9fe0),
  hemiSkyDay: col(0xbfd8ff), hemiSkyNight: col(0x24365e), hemiGroundDay: col(0x8f8496), hemiGroundNight: col(0x0d1018),
};

const WEATHER: Record<WeatherType, { overcast: number; fog: number; rain: number; wind: number }> = {
  clear: { overcast: 0, fog: 0.0042, rain: 0, wind: 0.25 },
  rain: { overcast: 0.7, fog: 0.009, rain: 0.6, wind: 0.5 },
  fog: { overcast: 0.5, fog: 0.03, rain: 0, wind: 0.12 },
  storm: { overcast: 0.95, fog: 0.012, rain: 1, wind: 1 },
};

export class Sky {
  sun = new THREE.DirectionalLight(0xffffff, 2);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private sunDisc: THREE.Mesh;
  private moonDisc: THREE.Mesh;
  private clouds: THREE.InstancedMesh;
  private cloudData: { x: number; y: number; z: number; s: number; r: number }[] = [];
  private cloudMat: THREE.MeshLambertMaterial;
  fog = new THREE.FogExp2(0xbfd8e6, 0.004);
  /** blended weather parameters */
  w = { ...WEATHER.clear };
  night = 0;
  dayF = 1;
  flash = 0;
  sunDir = new THREE.Vector3(0, 1, 0);
  private tmp = new THREE.Color();
  private top = new THREE.Color();
  private hor = new THREE.Color();

  constructor(private scene: THREE.Scene, shadows: boolean, shadowSize: number) {
    scene.fog = this.fog;
    scene.add(this.hemi);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 320;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.08;
    scene.add(this.sun, this.sun.target);

    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() }, uGlow: { value: new THREE.Color() }, uGlowK: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `varying vec3 vDir; uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uGlow; uniform float uGlowK;
        void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, -0.2, 1.0);
          vec3 c = mix(uHor, uTop, pow(smoothstep(-0.05, 0.75, h), 0.7));
          float s = max(dot(d, uSun), 0.0);
          c += uGlow * (pow(s, 6.0) * 0.35 + pow(s, 48.0) * 0.6) * uGlowK;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 12), this.domeMat);
    this.dome.frustumCulled = false; this.dome.renderOrder = -10;
    scene.add(this.dome);

    const rng = mulberry32(5);
    const n = 900, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * 6.283, y = rng() * 0.95 + 0.03, r = Math.sqrt(1 - y * y);
      sp[i * 3] = Math.cos(a) * r * 650; sp[i * 3 + 1] = y * 650; sp[i * 3 + 2] = Math.sin(a) * r * 650;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false; this.stars.renderOrder = -9;
    scene.add(this.stars);

    const disc = (r: number, c: number) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color: c, fog: false, depthWrite: false, transparent: true, toneMapped: false }));
      m.renderOrder = -8; m.frustumCulled = false; scene.add(m); return m;
    };
    this.sunDisc = disc(26, 0xfff1c9);
    this.moonDisc = disc(20, 0xe6ecff);

    const cg = merge([
      part(lumpy(ico(1, 1), 0.25, 3), 0xffffff, TRS(0, 0, 0, 0, 0, 0, 1.6, 0.6, 1), 0.03),
      part(lumpy(ico(0.8, 1), 0.2, 4), 0xffffff, TRS(1.2, 0.1, 0.3, 0, 0, 0, 1.3, 0.55, 1), 0.03),
      part(lumpy(ico(0.7, 1), 0.2, 5), 0xffffff, TRS(-1.3, -0.05, -0.2, 0, 0, 0, 1.3, 0.5, 1), 0.03),
    ]);
    this.cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.92, fog: false, emissive: 0xffffff, emissiveIntensity: 0.25 });
    const CN = 38;
    this.clouds = new THREE.InstancedMesh(cg, this.cloudMat, CN);
    this.clouds.frustumCulled = false;
    for (let i = 0; i < CN; i++) this.cloudData.push({ x: (rng() * 2 - 1) * 900, y: 150 + rng() * 90, z: (rng() * 2 - 1) * 900, s: 22 + rng() * 34, r: rng() * 6.28 });
    scene.add(this.clouds);
  }

  update(time: number, weather: WeatherType, focus: THREE.Vector3, camPos: THREE.Vector3, dt: number) {
    const tw = WEATHER[weather], k = 1 - Math.exp(-dt * 0.5);
    this.w.overcast = lerp(this.w.overcast, tw.overcast, k); this.w.fog = lerp(this.w.fog, tw.fog, k);
    this.w.rain = lerp(this.w.rain, tw.rain, k); this.w.wind = lerp(this.w.wind, tw.wind, k);
    const o = this.w.overcast;

    const ang = ((time - 6) / 12) * Math.PI;
    const e = Math.sin(ang);
    this.sunDir.set(Math.cos(ang) * 0.85, e, 0.38).normalize();
    const dayF = smoothstep(-0.14, 0.22, e);
    this.dayF = dayF; this.night = 1 - dayF;
    const dusk = clamp(1 - Math.abs(e) / 0.32, 0, 1) * smoothstep(-0.3, -0.05, e);

    this.top.copy(K.nightTop).lerp(K.dayTop, dayF).lerp(K.duskTop, dusk * 0.5);
    this.hor.copy(K.nightHor).lerp(K.dayHor, dayF).lerp(K.dusk, dusk * 0.75);
    this.tmp.copy(K.greyNight).lerp(K.greyDay, dayF);
    this.top.lerp(this.tmp, o * 0.85); this.hor.lerp(this.tmp, o * 0.8);
    if (this.flash > 0) { this.top.lerp(this.tmp.set(0xcfd8ff), this.flash * 0.6); this.hor.lerp(this.tmp, this.flash * 0.6); this.flash = Math.max(0, this.flash - dt * 4.5); }
    const U = this.domeMat.uniforms;
    U.uTop.value.copy(this.top); U.uHor.value.copy(this.hor);
    U.uSun.value.copy(this.sunDir); U.uGlow.value.copy(K.sunWarm).lerp(K.sunWhite, smoothstep(0, 0.5, e));
    U.uGlowK.value = (0.3 + dusk) * (1 - o) * smoothstep(-0.2, 0.05, e);
    this.dome.position.copy(camPos);
    this.stars.position.copy(camPos);
    this.stars.rotation.y = time * 0.02;
    (this.stars.material as THREE.PointsMaterial).opacity = this.night * (1 - o) * 0.95;

    this.sunDisc.position.copy(camPos).addScaledVector(this.sunDir, 640); this.sunDisc.lookAt(camPos);
    (this.sunDisc.material as THREE.MeshBasicMaterial).opacity = smoothstep(-0.08, 0.03, e) * (1 - o * 0.9);
    const moonDir = this.tmpV.copy(this.sunDir).multiplyScalar(-1); moonDir.z = 0.38; moonDir.normalize();
    this.moonDisc.position.copy(camPos).addScaledVector(moonDir, 640); this.moonDisc.lookAt(camPos);
    (this.moonDisc.material as THREE.MeshBasicMaterial).opacity = smoothstep(0.05, -0.1, e) * (1 - o * 0.85);

    // fog follows the horizon colour
    this.fog.color.copy(this.hor).lerp(this.top, 0.15);
    this.fog.density = this.w.fog * (1 + this.night * 0.25);

    // key light: sun by day, moon by night
    const useSun = e > -0.06;
    const dir = useSun ? this.sunDir : moonDir;
    this.sun.position.copy(focus).addScaledVector(dir, 150);
    this.sun.target.position.copy(focus);
    if (useSun) { this.sun.color.copy(K.sunWarm).lerp(K.sunWhite, smoothstep(0.05, 0.45, e)); this.sun.intensity = smoothstep(-0.06, 0.15, e) * 2.7 * (1 - o * 0.75); }
    else { this.sun.color.copy(K.moon); this.sun.intensity = smoothstep(-0.06, -0.2, e) * 0.5 * (1 - o * 0.7); }
    this.hemi.color.copy(K.hemiSkyNight).lerp(K.hemiSkyDay, dayF);
    this.hemi.groundColor.copy(K.hemiGroundNight).lerp(K.hemiGroundDay, dayF);
    this.hemi.intensity = lerp(0.42, 1.05, dayF) * (1 - o * 0.25) + this.flash * 2.5;

    // clouds drift with the wind; overcast makes them darker and denser
    const m = this.mat4, wind = dt * (2 + this.w.wind * 9);
    for (let i = 0; i < this.cloudData.length; i++) {
      const c = this.cloudData[i];
      c.x += wind; if (c.x > 900) c.x -= 1800;
      const s = c.s * (1 + o * 0.9);
      m.makeRotationY(c.r); m.scale(this.tmpV2.set(s, s * 0.8, s)); m.setPosition(c.x + camPos.x * 0.6, c.y - o * 25, c.z + camPos.z * 0.6);
      this.clouds.setMatrixAt(i, m);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    this.cloudMat.color.setScalar(1).lerp(this.tmp.set(0x59616b), o).multiplyScalar(lerp(0.16, 1, dayF)).lerp(K.dusk, dusk * 0.35 * (1 - o));
    this.cloudMat.emissiveIntensity = 0.22 * dayF * (1 - o * 0.6);
    this.cloudMat.opacity = 0.9;
  }
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private mat4 = new THREE.Matrix4();
}
