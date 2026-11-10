// Animated 2D backdrop for the main menu: dusk sky, layered ridges, pine silhouettes, campfire embers.
export function startMenuBackground(cv: HTMLCanvasElement): () => void {
  const ctx = cv.getContext('2d')!;
  let raf = 0, run = true, W = 0, H = 0;
  let s = 7;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const stars = Array.from({ length: 140 }, () => [rnd(), rnd() * 0.6, rnd() * 1.4 + 0.3, rnd() * 6]);
  const ridges = [0, 1, 2].map((k) => Array.from({ length: 40 }, () => rnd() * (0.5 + k * 0.25)));
  const pines = Array.from({ length: 46 }, (_, i) => ({ x: (i + rnd()) / 46, h: 0.16 + rnd() * 0.3, layer: rnd() < 0.5 ? 0 : 1 })).sort((a, b) => a.layer - b.layer);
  const embers = Array.from({ length: 70 }, () => ({ x: rnd(), y: rnd(), v: 0.03 + rnd() * 0.07, p: rnd() * 6, r: 0.8 + rnd() * 1.8 }));
  const resize = () => { W = cv.width = cv.clientWidth; H = cv.height = cv.clientHeight; };
  resize();
  window.addEventListener('resize', resize);
  const pine = (x: number, base: number, h: number, w: number) => {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const y0 = base - h * (0.25 + i * 0.19), ww = w * (1 - i * 0.2); ctx.moveTo(x - ww, y0); ctx.lineTo(x, y0 - h * 0.34); ctx.lineTo(x + ww, y0); }
    ctx.rect(x - w * 0.09, base - h * 0.28, w * 0.18, h * 0.3);
    ctx.fill();
  };
  const frame = (t: number) => {
    if (!run) return;
    raf = requestAnimationFrame(frame);
    const time = t / 1000;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a1024'); g.addColorStop(0.45, '#27264a'); g.addColorStop(0.7, '#8a4a3a'); g.addColorStop(0.86, '#e8843a'); g.addColorStop(1, '#3a1c14');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const [x, y, r, p] of stars) { ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 1.3 + p); ctx.fillStyle = '#dfe8ff'; ctx.fillRect(x * W, y * H, r, r); }
    ctx.globalAlpha = 1;
    const sun = ctx.createRadialGradient(W * 0.72, H * 0.8, 0, W * 0.72, H * 0.8, H * 0.5);
    sun.addColorStop(0, 'rgba(255,190,110,.75)'); sun.addColorStop(1, 'rgba(255,150,80,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
    ['#3b3157', '#2a2444', '#1b1a30'].forEach((c, k) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, H);
      const base = H * (0.62 + k * 0.08);
      ridges[k].forEach((v, i) => ctx.lineTo((i / 39) * W, base - v * H * 0.22 - Math.sin(i * 0.6 + k) * H * 0.03));
      ctx.lineTo(W, H); ctx.fill();
    });
    for (const p of pines) { ctx.fillStyle = p.layer ? '#0b0f16' : '#141a26'; pine(p.x * W, H * (p.layer ? 1.02 : 0.95), p.h * H * (p.layer ? 1.25 : 1), H * 0.045 * (p.layer ? 1.3 : 1)); }
    const fx = W * 0.72, fy = H * 0.93;
    const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, H * 0.3);
    glow.addColorStop(0, `rgba(255,150,60,${0.5 + Math.sin(time * 9) * 0.06})`); glow.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    for (const e of embers) {
      const yy = ((e.y - time * e.v) % 1 + 1) % 1;
      ctx.globalAlpha = Math.min(1, yy * 3) * (0.5 + 0.5 * Math.sin(time * 3 + e.p));
      ctx.fillStyle = yy > 0.6 ? '#ffb24a' : '#ff7a2a';
      ctx.beginPath(); ctx.arc(fx + (e.x - 0.5) * W * 0.5 * (1.2 - yy) + Math.sin(time + e.p) * 14, yy * H, e.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  raf = requestAnimationFrame(frame);
  return () => { run = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
}
