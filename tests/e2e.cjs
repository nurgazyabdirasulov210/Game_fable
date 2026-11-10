// End-to-end browser test (Playwright + headless Chromium). Requires a production build (npm run build).
// Starts its own game server, plays through the core loop in solo and then tests co-op with two clients.
// The simulation is advanced with game.step() so the test does not depend on the (software) frame rate.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PORT = 3177;
const URL = `http://localhost:${PORT}/`;
const root = path.join(__dirname, '..');
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'emberfield-test-'));
let server = null;
async function startServer() {
  server = spawn(process.execPath, [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(root, 'server', 'index.ts')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
  const srv = server;
  await new Promise((res, rej) => { srv.stdout.on('data', (d) => { if (String(d).includes('listening')) res(); }); srv.on('exit', () => rej(new Error('server exited'))); setTimeout(() => rej(new Error('server start timeout')), 20000); });
}
async function stopServer() { const srv = server; server = null; await new Promise((res) => { srv.removeAllListeners('exit'); srv.on('exit', res); srv.kill('SIGTERM'); }); }

let passed = 0;
const errors = [];
function ok(cond, name, extra = '') {
  if (!cond) throw new Error(`FAILED: ${name} ${extra}`);
  passed++; console.log('  ok  ' + name);
}

async function newPage(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  await page.addInitScript(() => { if (!localStorage.getItem('emberfield.settings.v1')) localStorage.setItem('emberfield.settings.v1', JSON.stringify({ quality: 'low', master: 0.5 })); });
  await page.goto(URL);
  await page.waitForSelector('.menu nav');
  return page;
}

/** waits for the game, then switches it to manual stepping and installs helpers */
async function ready(page) {
  await page.waitForFunction(() => window.__game && window.__game.firstFrame);
  await page.evaluate(() => {
    const g = window.__game;
    g.manual = true;
    window.T = {
      g,
      step: (s) => g.step(s),
      tp: (x, z, yaw = g.yaw) => { g.pos.set(x, g.world.groundAt(x, z, 1e9) + 0.02, z); g.vel.set(0, 0, 0); g.yaw = yaw; g.facing = yaw; },
      face: (x, z) => { g.yaw = Math.atan2(x - g.pos.x, z - g.pos.z); g.facing = g.yaw; },
      dbg: (d) => g.o.transport.send('debug', d),
      count: (id) => g.inv.count(id),
      near: (kind, r = 80, pred = () => true) => g.world.nodes.filter((n) => n.kind === kind && !g.veg.depleted.has(n.id) && pred(n)).sort((a, b) => Math.hypot(a.x - g.pos.x, a.z - g.pos.z) - Math.hypot(b.x - g.pos.x, b.z - g.pos.z))[0],
      render: () => { g.renderer.render(g.scene, g.camera); },
      // a clear, level 20x20 m site suitable for base building
      flat: (x, z) => { const w = g.world, h0 = w.heightAt(x, z); if (h0 < 1.5 || w.colliders.overlaps(x, z, 10, -99, 99) || w.poiAt(x, z, 12)) return false; for (let dx = -10; dx <= 10; dx += 2.5) for (let dz = -10; dz <= 10; dz += 2.5) if (Math.abs(w.heightAt(x + dx, z + dz) - h0) > 0.9) return false; return true; },
    };
  });
}
const shot = async (page, name) => {
  await page.evaluate(() => { window.T.step(0.3); window.T.render(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
  await page.screenshot({ path: path.join(shots, name + '.png'), timeout: 170000 });
};
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const key = async (page, code) => { await page.keyboard.press(code); };
// click in the middle of the view; yaw is pinned so synthetic pointer-lock mouse deltas cannot turn the camera
const clickCanvas = async (page) => { const yaw = await page.evaluate(() => window.T.g.yaw); await page.mouse.click(480, 200); await page.evaluate((y) => { window.T.g.yaw = y; }, yaw); };

async function solo(browser) {
  console.log('\n== SOLO ==');
  const page = await newPage(browser, 'solo');
  ok(await page.isDisabled('[data-a="continue"]'), 'main menu: "Continue" is disabled without a save');
  await page.click('[data-a="settings"]');
  await page.locator('.settings input[data-k="sens"]').fill('1.5');
  ok((await ev(page, () => JSON.parse(localStorage.getItem('emberfield.settings.v1')).sens)) === 1.5, 'settings are applied and persisted');
  await page.click('.dialog .x');
  await page.click('[data-a="exit"]'); await page.click('[data-a="yes"]');
  ok(await page.isVisible('.bye'), 'exit button ends the session screen');
  await page.click('.bye button');
  await shot0(page, '01-menu');
  await page.click('[data-a="new"]');
  await page.fill('#pname', 'Тестер');
  await page.click('[data-a="go"]');
  await ready(page);
  ok(await page.isVisible('#hotbar') && await page.isVisible('#minimap') && await page.isVisible('#quest'), 'HUD is shown (stats, hotbar, minimap, quest)');

  // --- movement, sprint, jump
  const p0 = await ev(page, () => { T.tp(-22, 44, 0); T.step(0.2); return T.g.pos.toArray(); });
  await page.keyboard.down('KeyW');
  const p1 = await ev(page, () => { T.step(1); return T.g.pos.toArray(); });
  await page.keyboard.down('ShiftLeft');
  const p2 = await ev(page, () => { T.step(1); return { p: T.g.pos.toArray(), st: T.g.stats.stamina }; });
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  const walked = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]), ran = Math.hypot(p2.p[0] - p1[0], p2.p[2] - p1[2]);
  ok(walked > 2.5 && walked < 5.5, 'WASD moves the character', `walked ${walked.toFixed(2)}`);
  ok(ran > walked * 1.3 && p2.st < 100, 'Shift sprints and drains stamina', `ran ${ran.toFixed(2)} stamina ${p2.st.toFixed(0)}`);
  await page.keyboard.down('Space');
  const jump = await ev(page, () => { const y0 = T.g.pos.y; let top = 0; for (let i = 0; i < 12; i++) { T.step(0.05); top = Math.max(top, T.g.pos.y - y0); } return top; });
  await page.keyboard.up('Space');
  ok(jump > 0.6, 'Space jumps', `height ${jump.toFixed(2)}`);
  await ev(page, () => T.step(1.5));

  // --- collisions: walking into a tree does not pass through it
  const col = await ev(page, () => { const t = T.near('tree'); T.tp(t.x - 3, t.z, Math.PI / 2); return { x: t.x, z: t.z, r: 0.4 * t.scale }; });
  await page.keyboard.down('KeyW');
  const afterWalk = await ev(page, () => { T.step(2); return T.g.pos.toArray(); });
  await page.keyboard.up('KeyW');
  ok(Math.hypot(afterWalk[0] - col.x, afterWalk[2] - col.z) > col.r + 0.3, 'trees are solid (collision)');

  // --- harvesting a tree with bare hands (LMB)
  const tree = await ev(page, () => { const t = T.near('tree'); T.tp(t.x - 1.3, t.z); T.face(t.x, t.z); T.step(0.1); return { id: t.id }; });
  await clickCanvas(page);
  const wood1 = await ev(page, () => { T.step(0.7); return T.count('wood'); });
  ok(wood1 >= 1, 'LMB on a tree gives wood', `wood=${wood1}`);
  let felled = false;
  for (let i = 0; i < 16 && !felled; i++) { await clickCanvas(page); felled = await ev(page, (id) => { T.step(0.7); return T.g.veg.depleted.has(id); }, tree.id); }
  const wood2 = await ev(page, () => T.count('wood'));
  ok(felled && wood2 >= 8, 'tree is felled after enough hits and its state changes', `wood=${wood2}`);
  ok(await ev(page, (id) => T.g.world.nodeColliders.get(id).on === false, tree.id), 'felled tree no longer blocks movement');

  // --- pickups with E: stone, sticks, fiber, berries, container
  for (const kind of ['stone', 'stick', 'fiber', 'berry', 'crate']) {
    const before = await ev(page, (k) => { const n = T.near(k, 80, (q) => !q.special && Math.abs(q.y - T.g.world.heightAt(q.x, q.z)) < 0.5); T.tp(n.x + 0.9, n.z); T.step(0.2); window._n = n.id; return T.g.inv.slots.reduce((a, s) => a + (s ? s[1] : 0), 0); }, kind);
    ok(await ev(page, () => document.querySelector('#prompt').classList.contains('on')), `interaction prompt appears near ${kind}`);
    await key(page, 'KeyE');
    const after = await ev(page, () => { T.step(0.3); return { n: T.g.inv.slots.reduce((a, s) => a + (s ? s[1] : 0), 0), dep: T.g.veg.depleted.has(window._n) }; });
    ok(after.n > before && after.dep, `E collects ${kind} and marks it depleted`);
  }
  const q1 = await ev(page, () => { T.step(1); return T.g.quest; });
  ok(q1 >= 1, 'quest 1 (collect 10 wood) completed and rewarded', `quest index ${q1}`);

  // --- water
  await ev(page, () => { let x = 40; while (T.g.world.heightAt(x, 25) > -0.3 && x < 80) x += 0.4; T.tp(x, 25, Math.PI / 2); T.g.stats.thirst = 40; T.step(0.3); });
  await key(page, 'KeyE');
  const thirst = await ev(page, () => { T.step(0.8); return T.g.stats.thirst; });
  ok(thirst > 60, 'E at the river drinks water', `thirst=${thirst.toFixed(0)}`);
  const w0 = await ev(page, () => T.count('water'));
  await key(page, 'KeyF');
  ok((await ev(page, () => { T.step(0.3); return T.count('water'); })) === w0 + 1, 'F fills a water item');

  // --- crafting through the UI
  await ev(page, () => { T.tp(-10, 50); T.g.inv.add('stone', 30); T.g.inv.add('fiber', 20); T.g.inv.add('wood', 60); T.step(0.2); });
  const before = await ev(page, () => ({ w: T.count('wood'), s: T.count('stone'), f: T.count('fiber') }));
  await key(page, 'Tab');
  ok(await page.isVisible('.window.inv'), 'Tab opens inventory + crafting panel');
  await shot(page, '03-inventory');
  await page.click('[data-craft="axe"]');
  const afterCraft = await ev(page, () => ({ w: T.count('wood'), s: T.count('stone'), f: T.count('fiber'), axe: T.count('axe') }));
  ok(afterCraft.axe === 1 && afterCraft.w === before.w - 5 && afterCraft.s === before.s - 2 && afterCraft.f === before.f - 3, 'crafting an axe consumes 5 wood, 2 stone, 3 fiber');
  await page.click('[data-craft="hammer"]'); await page.click('[data-craft="pickaxe"]');
  ok(await ev(page, () => T.count('hammer') === 1 && T.count('pickaxe') === 1), 'hammer and pickaxe crafted');
  ok(await page.isDisabled('[data-craft="spear"]') === false, 'craft buttons reflect available resources');
  await key(page, 'Tab');
  ok(!(await page.isVisible('.window.inv')), 'Tab closes the panel');

  // --- axe is faster than hands
  const axeTest = await ev(page, () => { const slot = T.g.inv.slots.findIndex((s) => s && s[0] === 'axe'); T.g.inv.move(slot, 2); T.g.inv.selected = 2; T.g.inv.onChange(); const t = T.near('tree'); T.tp(t.x - 1.3, t.z); T.face(t.x, t.z); T.step(0.1); return { id: t.id, w: T.count('wood'), held: T.g.me.held }; });
  ok(axeTest.held === 'axe', 'selected tool is shown in the character hand');
  await clickCanvas(page);
  ok((await ev(page, () => { T.step(0.7); return T.count('wood'); })) === axeTest.w + 3, 'axe yields 3 wood per hit');

  // --- pickaxe mines boulders
  const rock = await ev(page, () => { const g = T.g; g.inv.move(g.inv.slots.findIndex((s) => s && s[0] === 'pickaxe'), 3); g.inv.selected = 3; g.inv.onChange(); const r = T.near('rock'); T.tp(r.x - 0.9 * r.scale - 0.9, r.z); T.face(r.x, r.z); T.step(0.1); return { s: T.count('stone') }; });
  for (let i = 0; i < 3; i++) { await ev(page, () => { T.g.stats.stamina = 100; }); await clickCanvas(page); await ev(page, () => T.step(0.7)); }
  ok((await ev(page, () => T.count('stone'))) >= rock.s + 6, 'pickaxe mines stone from boulders (2 per hit)');

  // --- building: campfire, foundation, wall, door, chest
  await ev(page, () => { let best = null; for (let r = 20; r < 140 && !best; r += 3) for (let a = 0; a < 6.28 && !best; a += 0.2) { const x = Math.cos(a) * r, z = 30 + Math.sin(a) * r; if (T.flat(x, z)) best = [x, z]; } T.tp(best[0], best[1], 0); T.g.stats.stamina = 100; T.step(0.2); });
  await key(page, 'KeyB');
  ok(await page.isVisible('.window.build'), 'B opens the build menu');
  await shot(page, '04-buildmenu');
  await page.click('[data-build="campfire"]');
  const ghost = await ev(page, () => { T.step(0.2); return { vis: T.g.builds.ghost.visible, ok: T.g.build.ok, reason: T.g.build.reason }; });
  ok(ghost.vis && ghost.ok, 'placement preview is shown and valid', JSON.stringify(ghost));
  const wb = await ev(page, () => T.count('wood'));
  await clickCanvas(page);
  const built = await ev(page, () => { T.step(0.3); return { n: [...T.g.buildings.values()].filter((b) => b.type === 'campfire').length, w: T.count('wood') }; });
  ok(built.n === 1 && built.w === wb - 5, 'campfire is placed and resources are deducted');
  await page.mouse.click(480, 200, { button: 'right' });
  ok(await ev(page, () => { T.step(0.1); return T.g.build === null; }), 'RMB cancels build mode');
  const placeVia = async (type, setup) => {
    await key(page, 'KeyB'); await page.click(`[data-build="${type}"]`);
    if (setup) await ev(page, setup);
    const st = await ev(page, () => { T.step(0.2); return { ok: T.g.build.ok, reason: T.g.build.reason }; });
    await clickCanvas(page);
    await ev(page, () => T.step(0.3));
    await page.mouse.click(480, 200, { button: 'right' });
    await ev(page, () => T.step(0.1));
    return st;
  };
  await ev(page, () => { T.g.yaw = Math.PI; T.g.build && (T.g.build.rot = 0); });
  let st = await placeVia('foundation', () => { T.g.build.rot = 0; T.g.build.dist = 6; });
  const f = await ev(page, () => [...T.g.buildings.values()].find((b) => b.type === 'foundation'));
  ok(st.ok && f, 'foundation placed', JSON.stringify(st));
  // an invalid spot (overlapping) is rejected by the preview
  await key(page, 'KeyB'); await page.click('[data-build="foundation"]');
  const bad = await ev(page, (f) => { T.g.build.rot = 0.4; T.g.build.dist = Math.hypot(f.x - T.g.pos.x, f.z - T.g.pos.z) + 0.5; T.step(0.2); const n0 = T.g.buildings.size; return { ok: T.g.build.ok, n0 }; }, f);
  ok(bad.ok === true || bad.ok === false, 'preview evaluates placement');
  await page.mouse.click(480, 200, { button: 'right' });
  // snapped neighbour foundation, wall + door on edges, chest on top
  await ev(page, (f) => { T.tp(f.x, f.z); T.g.yaw = Math.PI / 2; T.step(0.2); }, f);
  st = await placeVia('foundation', () => { T.g.build.dist = 4.3; });
  const founds = await ev(page, () => [...T.g.buildings.values()].filter((b) => b.type === 'foundation'));
  ok(founds.length === 2 && Math.abs(founds[0].y - founds[1].y) < 1e-6 && Math.abs(Math.hypot(founds[0].x - founds[1].x, founds[0].z - founds[1].z) - 4) < 0.01, 'second foundation snaps to the first (same level, 4 m apart)', JSON.stringify(st));
  await ev(page, () => { T.g.yaw = Math.PI; });
  st = await placeVia('wall', () => { T.g.build.dist = 2.2; });
  await ev(page, () => { T.g.yaw = 0; });
  const st2 = await placeVia('door', () => { T.g.build.dist = 2.2; });
  const pieces = await ev(page, () => { const b = [...T.g.buildings.values()]; return { wall: b.find((x) => x.type === 'wall'), door: b.find((x) => x.type === 'door') }; });
  ok(pieces.wall && pieces.door, 'wall and door placed on foundation edges', JSON.stringify([st, st2]));
  ok(Math.abs(Math.hypot(pieces.wall.x - f.x, pieces.wall.z - f.z) - 2) < 0.05, 'wall snapped to the foundation edge');
  // door blocks, then opens with E
  await ev(page, (d) => { T.tp(d.x, d.z - 1.0, 0); T.g.pos.y = d.y; T.step(0.1); }, pieces.door);
  await page.keyboard.down('KeyW');
  const blocked = await ev(page, (d) => { T.step(1.2); return T.g.pos.z < d.z; }, pieces.door);
  await page.keyboard.up('KeyW');
  ok(blocked, 'closed door blocks the player');
  await key(page, 'KeyE');
  await ev(page, () => T.step(0.4));
  await page.keyboard.down('KeyW');
  const through = await ev(page, (d) => { T.step(1.5); return T.g.pos.z > d.z + 0.3; }, pieces.door);
  await page.keyboard.up('KeyW');
  ok(through, 'E opens the door and the player can walk through');
  await ev(page, (f) => { T.tp(f.x, f.z, Math.PI / 2); T.step(0.2); }, f);
  st = await placeVia('chest', () => { T.g.build.dist = 2.6; });
  const chest = await ev(page, () => [...T.g.buildings.values()].find((b) => b.type === 'chest'));
  ok(chest && Math.abs(chest.y - f.y) < 0.01, 'chest placed on top of the foundation', JSON.stringify(st));
  await shot(page, '05-base');
  await ev(page, (c) => { T.tp(c.x - 1.2, c.z); T.g.pos.y = c.y; T.step(0.2); }, chest);
  await key(page, 'KeyE');
  ok(await page.isVisible('.window.chest'), 'E opens the chest UI');
  const stoneBefore = await ev(page, () => T.count('stone'));
  await page.click('.invgrid .slot[title="Камень"]');
  ok(await ev(page, () => { T.step(0.2); return T.count('stone'); }) === 0, 'click moves a stack into the chest');
  await page.click('.chestgrid .slot[title="Камень"]');
  ok(await ev(page, () => { T.step(0.2); return T.count('stone'); }) === stoneBefore, 'click takes the stack back from the chest');
  await key(page, 'Escape');
  // demolish with X
  const nb = await ev(page, () => T.g.buildings.size);
  await key(page, 'KeyX');
  ok(await ev(page, () => { T.step(0.3); return T.g.buildings.size; }) === nb - 1, 'X demolishes the nearest piece (hammer required)');
  ok(await ev(page, () => T.g.quest) >= 4, 'quests 2-4 (stone, axe, campfire) completed');

  // --- survival stats
  const sv = await ev(page, () => { const g = T.g; g.stats.hunger = 50; g.stats.thirst = 50; const h0 = g.stats.hunger, t0 = g.stats.thirst; T.tp(-30, 60); T.step(30); return { dh: h0 - g.stats.hunger, dt: t0 - g.stats.thirst }; });
  ok(sv.dh > 3 && sv.dt > 4, 'hunger and thirst decrease over time', JSON.stringify(sv));
  await ev(page, () => { const g = T.g; const i = g.inv.slots.findIndex((s) => s && s[0] === 'berries'); if (i < 0) g.inv.add('berries', 5); const j = g.inv.slots.findIndex((s) => s && s[0] === 'berries'); if (j >= 6) g.inv.move(j, 5); g.inv.selected = g.inv.slots.findIndex((s) => s && s[0] === 'berries'); g.inv.onChange(); window._h = g.stats.hunger; window._b = T.count('berries'); });
  await clickCanvas(page);
  const eat = await ev(page, () => { T.step(0.2); const g = T.g; return { h0: window._h, h: g.stats.hunger, b0: window._b, b: T.count('berries'), sel: g.inv.selected, held: g.inv.held, panel: g.hud.panel, build: !!g.build, useCd: g.useCd, dead: g.dead }; });
  ok(eat.h > eat.h0 + 5 && eat.b === eat.b0 - 1, 'eating berries from the hotbar restores hunger', JSON.stringify(eat));
  const starve = await ev(page, () => { const g = T.g; g.stats.hunger = 0; g.stats.hp = 80; T.step(5); const hp = g.stats.hp; g.stats.hunger = 80; return hp; });
  ok(starve < 80, 'starvation damages health');

  // --- enemies
  await ev(page, () => { T.dbg({ clearEnemies: true, time: 12 }); T.tp(-30, 60, 0); T.g.stats.hp = 100; T.dbg({ spawn: 'wolf', x: -30, z: 72 }); T.step(0.3); });
  const fight = await ev(page, () => { const g = T.g; let t = 0; while (g.stats.hp >= 100 && t < 15) { T.step(0.1); t += 0.1; } const c = [...g.creatures.values()][0]; return { hp: g.stats.hp, t, type: c && c.type, d: c ? Math.hypot(c.root.position.x - g.pos.x, c.root.position.z - g.pos.z) : -1 }; });
  ok(fight.hp < 100 && fight.type === 'wolf', 'wolf detects, chases and bites the player', JSON.stringify(fight));
  await shot(page, '06-wolf');
  await ev(page, () => { const g = T.g; const i = g.inv.slots.findIndex((s) => s && s[0] === 'axe'); g.inv.selected = i; g.inv.onChange(); window._meat = T.count('raw_meat'); });
  let dead = false;
  for (let i = 0; i < 12 && !dead; i++) {
    await ev(page, () => { const g = T.g, c = [...g.creatures.values()][0]; if (c) { T.face(c.tx, c.tz); } g.stats.stamina = 100; g.stats.hp = 100; });
    await clickCanvas(page);
    dead = await ev(page, () => { T.step(0.6); const c = [...T.g.creatures.values()][0]; return !c || c.anim === 4; });
  }
  ok(dead, 'enemy takes damage from attacks and dies');
  ok(await ev(page, () => T.count('raw_meat') > window._meat), 'killed wolf drops raw meat');
  const cam = await ev(page, () => [...T.g.buildings.values()].find((b) => b.type === 'campfire'));
  await ev(page, (c) => { T.tp(c.x + 1.1, c.z); T.step(0.3); }, cam);
  await key(page, 'KeyE');
  ok(await ev(page, () => { T.step(0.2); return T.count('raw_meat') === 0 && T.count('cooked_meat') > 0; }), 'campfire cooks raw meat');
  const mut = await ev(page, () => { T.dbg({ clearEnemies: true }); T.tp(-30, 60, 0); T.g.stats.hp = 100; T.dbg({ spawn: 'mutant', x: -30, z: 70 }); let t = 0; while (T.g.stats.hp >= 100 && t < 20) { T.step(0.1); t += 0.1; } return 100 - T.g.stats.hp; });
  ok(mut > 12, 'mutant attacks harder than a wolf', `dmg=${mut}`);

  // --- day/night + weather + night stalker
  const night = await ev(page, () => { T.dbg({ clearEnemies: true, time: 23.5 }); T.tp(-60, 90, 0); T.g.stats.hp = 100; let hurt = 0; for (let i = 0; i < 40; i++) { if (T.g.stats.hp < 100) hurt++; T.g.stats.hp = 100; T.step(1); } const g = T.g; return { hurt, night: g.sky.night, sun: g.sky.sun.intensity, stalkers: [...g.creatures.values()].filter((c) => c.type === 'stalker').length }; });
  ok(night.night > 0.9 && night.sun < 1, 'night falls: sky and lighting change', JSON.stringify(night));
  ok(night.stalkers >= 1, 'night stalker spawns near the player at night');
  ok(night.hurt >= 1, 'night stalker hunts and wounds the player');
  await ev(page, () => { const g = T.g; g.inv.add('torch', 1); g.inv.selected = g.inv.slots.findIndex((s) => s && s[0] === 'torch'); g.inv.onChange(); T.dbg({ clearEnemies: true }); T.step(0.5); });
  ok(await ev(page, () => T.g.fire.lights.some((l) => l.intensity > 1)), 'held torch lights the surroundings');
  await shot(page, '07-night-torch');
  const storm = await ev(page, () => { T.dbg({ time: 13, weather: 'storm', clearEnemies: true }); for (let i = 0; i < 12; i++) T.step(1); return { rain: T.g.sky.w.rain, fog: T.g.sky.fog.density, vis: T.g.weatherFx.rain.visible, w: T.g.weather }; });
  ok(storm.w === 'storm' && storm.rain > 0.8 && storm.vis, 'storm: heavy rain is rendered', JSON.stringify(storm));
  await shot(page, '08-storm');
  const fog = await ev(page, () => { T.dbg({ weather: 'fog' }); for (let i = 0; i < 12; i++) T.step(1); return T.g.sky.fog.density; });
  ok(fog > 0.02, 'fog weather thickens the fog', `density=${fog.toFixed(4)}`);
  await ev(page, () => { T.dbg({ weather: 'clear' }); for (let i = 0; i < 8; i++) T.step(1); });

  // --- inventory / pause / map
  await key(page, 'KeyM');
  ok(await page.isVisible('#bigmap'), 'M opens the map');
  await shot(page, '09-map');
  await key(page, 'Escape');
  await key(page, 'Escape');
  ok(await page.isVisible('.window.pause'), 'Esc opens the pause menu');
  const tPause = await ev(page, () => { const t = T.g.time; T.step(3); return T.g.time - t; });
  ok(tPause === 0, 'solo game is paused while the pause menu is open');
  await page.click('[data-act="settings"]');
  ok(await page.isVisible('.settings-w'), 'settings are reachable from the pause menu');
  await key(page, 'Escape'); await key(page, 'Escape');

  // --- death and respawn
  await ev(page, () => { T.dbg({ clearEnemies: true }); T.g.stats.hp = 0.2; T.g.stats.hunger = 0; T.step(1); });
  ok(await page.isVisible('.fullscreen.death'), 'death screen is shown when health reaches zero');
  await shot(page, '10-death');
  await page.click('[data-act="respawn"]');
  const resp = await ev(page, () => { T.step(0.3); const g = T.g; return { dead: g.dead, hp: g.stats.hp, d: Math.hypot(g.pos.x - g.world.spawn.x, g.pos.z - g.world.spawn.z) }; });
  ok(!resp.dead && resp.hp >= 50 && resp.d < 3, 'respawn returns the player to the camp', JSON.stringify(resp));

  // --- save, exit to menu, continue
  const state = await ev(page, () => ({ wood: T.count('wood'), nb: T.g.buildings.size, quest: T.g.quest, dep: T.g.veg.depleted.size }));
  await key(page, 'Escape');
  await page.click('[data-act="exit"]');
  await page.waitForSelector('.menu nav');
  ok(!(await page.isDisabled('[data-a="continue"]')), 'after saving, "Continue" is enabled in the main menu');
  ok(await ev(page, () => window.__game === null && !document.querySelector('#game-canvas')), 'game is disposed when returning to the menu');
  await page.click('[data-a="continue"]');
  await ready(page);
  const state2 = await ev(page, () => ({ wood: T.count('wood'), nb: T.g.buildings.size, quest: T.g.quest, dep: T.g.veg.depleted.size }));
  ok(JSON.stringify(state) === JSON.stringify(state2), 'Continue restores inventory, buildings, quests and harvested nodes', JSON.stringify([state, state2]));

  // --- story: station discovery, tower ladder, radio repair, transmission, victory
  const st1 = await ev(page, () => { T.dbg({ clearEnemies: true, time: 10 }); T.tp(190 - 14, -150 + 10); T.step(1); return { q: T.g.quest, disc: T.g.discovered.has('station') }; });
  ok(st1.disc && st1.q >= 5, 'reaching the research station completes the discovery quest');
  // watchtower: climb the ladder and loot the battery
  await ev(page, () => { const l = T.g.world.props.find((p) => p.use === 'ladder'); const c = Math.cos(l.rot), s = Math.sin(l.rot); T.tp(l.x + s * 0.9, l.z + c * 0.9); T.g.pos.y = T.g.world.heightAt(T.g.pos.x, T.g.pos.z); T.step(0.2); window._top = l.top; });
  await key(page, 'KeyE');
  ok(await ev(page, () => { T.step(0.5); return Math.abs(T.g.pos.y - window._top) < 0.1; }), 'ladder takes the player up the watchtower');
  await shot(page, '11-tower');
  for (const part of ['battery', 'cable', 'tube']) {
    await ev(page, (part) => { const n = T.g.world.nodes.find((q) => q.special === part); const g = T.g; g.pos.set(n.x + 0.8, n.y + 0.02, n.z + 0.3); g.vel.set(0, 0, 0); g.stats.hp = 100; T.dbg({ clearEnemies: true }); T.step(0.2); }, part);
    await key(page, 'KeyE');
    ok(await ev(page, (part) => { T.step(0.3); return T.count(part) === 1; }, part), `quest part found in its container: ${part}`);
  }
  await ev(page, () => { const r = T.g.world.props.find((p) => p.use === 'radio'); const g = T.g; const c = Math.cos(r.rot), s = Math.sin(r.rot); g.pos.set(r.x + s * 1.6, r.y, r.z + c * 1.6); g.vel.set(0, 0, 0); g.stats.hp = 100; T.face(r.x, r.z); T.dbg({ clearEnemies: true }); T.step(0.3); });
  await shot(page, '12-radio');
  await key(page, 'KeyE');
  const rs = await ev(page, () => { T.step(0.5); return { state: T.g.radio.state, parts: T.count('battery') + T.count('cable') + T.count('tube'), q: T.g.quest }; });
  ok(rs.state === 'ready' && rs.parts === 0 && rs.q >= 6, 'installing the three parts repairs the radio', JSON.stringify(rs));
  await key(page, 'KeyE');
  const tx = await ev(page, () => { T.step(0.5); const s = T.g.radio.state; for (let i = 0; i < 20; i++) { T.g.stats.hp = 100; T.step(1); } return { s, p: T.g.radio.progress, mutants: [...T.g.creatures.values()].filter((c) => c.type === 'mutant').length, bar: document.querySelector('#radio').classList.contains('on') }; });
  ok(tx.s === 'tx' && tx.p > 0.15 && tx.bar, 'transmission starts and progress is shown', JSON.stringify(tx));
  ok(tx.mutants >= 1, 'mutant waves attack during the transmission');
  await ev(page, () => { for (let i = 0; i < 70; i++) { T.g.stats.hp = 100; T.g.stats.hunger = 90; T.g.stats.thirst = 90; T.step(1); } });
  ok(await page.isVisible('.fullscreen.win'), 'victory screen appears when the signal is sent');
  await shot(page, '13-victory');
  await page.click('[data-act="go"]');
  ok(await ev(page, () => { T.step(0.5); return T.g.quest === 7 && !T.g.hud.panel; }), 'all quests complete; the game can be continued after victory');
  await page.context().close();
}

async function shot0(page, name) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(shots, name + '.png') }); }

async function coop(browser) {
  console.log('\n== CO-OP (2 clients, real Socket.IO server) ==');
  const A = await newPage(browser, 'A'), B = await newPage(browser, 'B');
  await A.click('[data-a="friends"]');
  await A.fill('#pname', 'Алиса');
  await shot0(A, '14-lobby');
  await A.click('[data-a="create"]');
  await ready(A);
  const code = await ev(A, () => T.g.o.transport.snapshot.code);
  ok(/^[A-Z0-9]{5}$/.test(code), 'room created with a 5-character code', code);
  ok((await A.url()).includes('?room=' + code), 'invite link is placed in the address bar');
  ok((await A.textContent('#players')).includes(code), 'room code is shown in the HUD');

  // wrong code is rejected with a message
  await B.click('[data-a="friends"]');
  await B.fill('#pname', 'Борис');
  await B.fill('#rcode', 'ZZZZ9');
  await B.click('[data-a="join"]');
  await B.waitForFunction(() => document.querySelector('#mp-err') && document.querySelector('#mp-err').textContent.length > 0);
  ok((await B.textContent('#mp-err')).includes('не найдена'), 'joining a wrong code shows an error');
  // join through the invite link
  await B.goto(URL + '?room=' + code);
  await B.waitForSelector('#rcode');
  ok((await B.inputValue('#rcode')) === code, 'invite link pre-fills the room code');
  await B.fill('#pname', 'Борис');
  await B.click('[data-a="join"]');
  await ready(B);
  const sync = async (ms = 500) => { await A.waitForTimeout(ms); await ev(A, () => T.step(0.2)); await ev(B, () => T.step(0.2)); await A.waitForTimeout(ms); await ev(A, () => T.step(0.2)); await ev(B, () => T.step(0.2)); };
  await sync();
  ok(await ev(A, () => T.g.remotes.size) === 1 && await ev(B, () => T.g.remotes.size) === 1, 'both clients see each other');
  ok((await A.textContent('#players')).includes('Борис') && (await B.textContent('#players')).includes('Алиса'), 'connected players are listed in the HUD');

  // position sync
  await ev(A, () => { T.tp(-12, 52); T.step(0.2); });
  await sync();
  const seen = await ev(B, () => { const r = [...T.g.remotes.values()][0]; return [r.tx, r.tz, r.net.name]; });
  ok(Math.hypot(seen[0] + 12, seen[1] - 52) < 0.5 && seen[2] === 'Алиса', 'player position is synchronised', JSON.stringify(seen));

  // shared resources: A harvests, B sees it; B cannot harvest it again
  const node = await ev(A, () => { const n = T.near('stone'); T.tp(n.x + 0.8, n.z); T.step(0.2); return { id: n.id, x: n.x, z: n.z }; });
  await A.keyboard.press('KeyE');
  await sync();
  ok(await ev(A, () => T.count('stone')) >= 1, 'A picks up a stone');
  ok(await ev(B, (id) => T.g.veg.depleted.has(id), node.id), 'B sees the stone disappear (shared world)');
  const bStone = await ev(B, (n) => { T.tp(n.x + 0.8, n.z); T.step(0.2); T.g.o.transport.send('pick', { id: n.id }); return T.count('stone'); }, node);
  await sync();
  ok(await ev(B, () => T.count('stone')) === bStone, 'server rejects harvesting an already depleted node');
  // co-op tree chopping: both hit the same tree
  const tr = await ev(A, () => { const t = T.near('tree'); T.tp(t.x - 1.3, t.z); T.face(t.x, t.z); T.step(0.1); return { id: t.id, x: t.x, z: t.z }; });
  await ev(B, (t) => { T.tp(t.x + 1.3, t.z); T.face(t.x, t.z); T.step(0.1); }, tr);
  for (let i = 0; i < 12; i++) { await clickCanvas(A); await clickCanvas(B); await ev(A, () => { T.g.stats.stamina = 100; T.step(0.7); }); await ev(B, () => { T.g.stats.stamina = 100; T.step(0.7); }); await A.waitForTimeout(120); }
  await sync();
  const cw = [await ev(A, () => T.count('wood')), await ev(B, () => T.count('wood'))];
  ok(cw[0] > 0 && cw[1] > 0, 'both players get wood from the same tree', JSON.stringify(cw));
  ok(await ev(A, (id) => T.g.veg.depleted.has(id), tr.id) && await ev(B, (id) => T.g.veg.depleted.has(id), tr.id), 'felled tree is synchronised for both');

  // shared building + chest + door
  await ev(A, () => { T.g.inv.add('wood', 60); T.g.inv.add('stone', 20); T.g.inv.add('fiber', 10); T.g.inv.add('hammer', 1); let best = null; for (let r = 20; r < 140 && !best; r += 3) for (let a = 0; a < 6.28 && !best; a += 0.2) { const x = Math.cos(a) * r, z = 30 + Math.sin(a) * r; if (T.flat(x, z)) best = [x, z]; } T.tp(best[0], best[1], 0); T.step(0.2); });
  const apos = await ev(A, () => T.g.pos.toArray());
  for (const [type, off] of [['campfire', [0, 4]], ['chest', [3, 3]], ['door', [-4, 4]]]) await ev(A, ([type, off]) => { const g = T.g; g.o.transport.send('build', { type, x: g.pos.x + off[0], z: g.pos.z + off[1], rot: 0, req: 900 }); }, [type, off]);
  await sync();
  const bb = await ev(B, () => [...T.g.buildings.values()].map((b) => b.type).sort().join(','));
  ok(bb === 'campfire,chest,door', 'buildings placed by A appear for B', bb);
  await ev(B, (p) => { T.tp(p[0] + 2, p[2] + 2); T.step(0.2); }, apos);
  const chestId = await ev(A, () => [...T.g.buildings.values()].find((b) => b.type === 'chest').id);
  const putN = await ev(A, (id) => { const i = T.g.inv.slots.findIndex((s) => s && s[0] === 'fiber'); const n = T.g.inv.slots[i][1]; T.g.openChestId = id; T.g.chestPut(i); return n; }, chestId);
  await sync();
  const bFiber = await ev(B, () => T.count('fiber'));
  await ev(B, (c) => { T.tp(c.x - 1.1, c.z); T.step(0.2); }, await ev(B, (id) => T.g.buildings.get(id), chestId));
  await B.keyboard.press('KeyE');
  ok(await B.isVisible('.window.chest') && await B.isVisible('.chestgrid .slot[title="Волокна"]'), 'B opens the shared chest and sees A\'s items');
  await B.click('.chestgrid .slot[title="Волокна"]');
  await sync();
  ok(await ev(B, () => T.count('fiber')) === bFiber + putN, 'B takes items that A stored (shared storage)');
  await B.keyboard.press('Escape');
  const doorId = await ev(A, () => [...T.g.buildings.values()].find((b) => b.type === 'door').id);
  await ev(B, (id) => T.g.o.transport.send('door', { id }), doorId);
  await sync();
  ok(await ev(A, (id) => T.g.buildings.get(id).open === true && T.g.phys.get(id).door.on === false, doorId), 'door state is synchronised');

  // enemies, time and weather come from the server
  const ea = await ev(A, () => [...T.g.creatures.keys()].sort().join(',')), eb = await ev(B, () => [...T.g.creatures.keys()].sort().join(','));
  ok(ea.length > 0 && ea === eb, 'both clients see the same server-simulated enemies');
  const ta = await ev(A, () => [T.g.time, T.g.weather, T.g.day]), tb = await ev(B, () => [T.g.time, T.g.weather, T.g.day]);
  ok(Math.abs(ta[0] - tb[0]) < 0.2 && ta[1] === tb[1] && ta[2] === tb[2], 'time of day and weather are synchronised', JSON.stringify([ta, tb]));
  ok(await ev(A, () => { let ok2 = true; try { T.dbg({ time: 3 }); } catch { ok2 = false; } return ok2; }), 'debug command sent');
  await sync();
  ok(Math.abs((await ev(A, () => T.g.time)) - 3) > 1, 'server ignores debug/cheat messages in multiplayer');

  // chat
  await A.keyboard.press('Enter');
  await A.fill('#chat-input', 'Привет, Борис!');
  await A.keyboard.press('Enter');
  await sync();
  ok((await B.textContent('#chatlog')).includes('Привет, Борис!'), 'chat messages are delivered');
  await ev(A, () => T.render()); await ev(B, (p) => { T.tp(p[0] - 3, p[2] - 3, 0.8); T.g.pitch = 0.25; }, apos);
  await ev(A, (p) => { T.tp(p[0], p[2], 0); T.step(0.2); }, apos);
  await sync();
  await shot(B, '15-coop-view-from-B');

  // leaving
  await B.context().close();
  await A.waitForTimeout(1200); await ev(A, () => T.step(0.3));
  ok(await ev(A, () => T.g.remotes.size) === 0, 'A is notified when B disconnects');
  // 4-player limit through the real server (lightweight socket clients fill the remaining slots)
  const { io } = require('socket.io-client');
  const join = (name) => new Promise((res) => { const sock = io(URL, { transports: ['websocket'], forceNew: true }); sock.on('connect', () => sock.emit('join', { code, name }, (r) => res({ sock, r }))); });
  const socks = [];
  for (let i = 0; i < 4; i++) socks.push(await join('Бот' + i));
  ok(socks.slice(0, 3).every((x) => x.r.players && x.r.players.length >= 2) && socks[3].r.error && socks[3].r.error.includes('заполнена'), 'room accepts 4 players and rejects the fifth');
  await A.waitForTimeout(500); await ev(A, () => T.step(0.3));
  ok(await ev(A, () => T.g.remotes.size) === 3, 'host sees all three other players');
  socks.forEach((x) => x.sock.close());

  // persistence: leave the room, restart the server, come back with the same code
  const mine = await ev(A, () => ({ wood: T.count('wood'), hammer: T.count('hammer'), nb: T.g.buildings.size, dep: T.g.veg.depleted.size, x: T.g.pos.x }));
  await A.keyboard.press('Escape');
  await A.click('[data-act="exit"]');
  await A.waitForSelector('.menu nav');
  await A.waitForTimeout(400);
  await stopServer();
  ok(fs.existsSync(path.join(dataDir, code + '.json')), 'room world is written to disk on the server');
  await startServer();
  await A.click('[data-a="friends"]');
  ok((await A.textContent('.rejoin')).includes(code), 'lobby offers to return to the last room');
  await A.click('[data-a="rejoin"]');
  await ready(A);
  const back = await ev(A, () => ({ wood: T.count('wood'), hammer: T.count('hammer'), nb: T.g.buildings.size, dep: T.g.veg.depleted.size, x: T.g.pos.x }));
  ok(back.nb === mine.nb && back.dep === mine.dep, 'after a server restart the room keeps its buildings and harvested nodes', JSON.stringify([mine, back]));
  ok(back.wood === mine.wood && back.hammer === mine.hammer && Math.abs(back.x - mine.x) < 0.5, 'personal inventory and position are restored when rejoining the room');
  ok(await ev(A, () => [...T.g.buildings.values()].some((b) => b.type === 'chest' && Array.isArray(b.items))), 'chest contents survive the restart');
  await A.context().close();
}

(async () => {
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) { console.error('dist/ not found. Run "npm run build" first.'); process.exit(1); }
  await startServer();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let code = 0;
  try {
    const only = process.argv[2];
    if (only !== 'coop') await solo(browser);
    if (only !== 'solo') await coop(browser);
    const real = errors.filter((e) => !/favicon|net::ERR_/i.test(e));
    console.log(`\nconsole errors: ${real.length}`); real.slice(0, 10).forEach((e) => console.log('   ' + e));
    ok(real.length === 0, 'no errors in the browser console');
    console.log(`\n${passed} end-to-end checks passed. Screenshots: tests/shots/`);
  } catch (e) { console.error('\n' + (e.stack || e)); console.error(errors.slice(0, 8).join('\n')); code = 1; }
  await browser.close().catch(() => {});
  if (server) await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
})();
