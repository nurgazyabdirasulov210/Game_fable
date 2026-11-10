// Headless tests of the shared simulation (world generation + room logic).
import assert from 'node:assert/strict';
import { World, CAMP, BRIDGE, STATION } from '../shared/world';
import { Room, checkPlacement, nodeMaxHp, TX_DURATION } from '../shared/room';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name); throw e; }
}

const t0 = Date.now();
const world = new World();
console.log(`world generated in ${Date.now() - t0} ms: ${world.nodes.length} nodes, ${world.boxes.length} boxes, ${world.props.length} props`);
const count = (k: string) => world.nodes.filter((n) => n.kind === k).length;
console.log('  trees', count('tree'), 'rocks', count('rock'), 'stones', count('stone'), 'sticks', count('stick'), 'fiber', count('fiber'), 'berry', count('berry'), 'crates', count('crate'));

test('world is deterministic', () => {
  const w2 = new World();
  assert.equal(w2.nodes.length, world.nodes.length);
  for (let i = 0; i < world.nodes.length; i += 97) assert.deepEqual(w2.nodes[i], world.nodes[i]);
  assert.equal(w2.heightAt(12.3, -45.6), world.heightAt(12.3, -45.6));
});

test('terrain: camp is dry land, river is water, mountains ring the valley', () => {
  assert.ok(world.heightAt(CAMP.x, CAMP.z) > 1);
  assert.ok(world.heightAt(BRIDGE.x, BRIDGE.z) < -1, 'river under the bridge');
  assert.ok(world.heightAt(120, 172) < -2, 'lake');
  assert.ok(world.heightAt(0, -310) > 40 && world.heightAt(310, 0) > 40, 'mountains');
});

test('bridge is walkable from bank to bank', () => {
  const c = Math.cos(BRIDGE.rot), s = Math.sin(BRIDGE.rot);
  let y = world.heightAt(BRIDGE.x - 16 * c, BRIDGE.z + 16 * s);
  for (let t = -16; t <= 16; t += 0.25) {
    const g = world.groundAt(BRIDGE.x + t * c, BRIDGE.z - t * s, y);
    assert.ok(g > 0.5, `dry at t=${t} (g=${g.toFixed(2)})`);
    assert.ok(Math.abs(g - y) < 0.65, `step ok at t=${t}`);
    y = g;
  }
});

test('all quest parts exist exactly once', () => {
  for (const part of ['battery', 'cable', 'tube']) assert.equal(world.nodes.filter((n) => n.special === part).length, 1, part);
});

test('enough resources', () => {
  assert.ok(count('tree') > 800 && count('rock') > 150 && count('fiber') > 200 && count('berry') > 80);
});

const events: [string | null, string, any][] = [];
const room = new Room('TEST', (to, type, data) => events.push([to, type, data]), new World());
room.debug = true;
const take = (type: string) => { const r = events.filter((e) => e[1] === type); return r; };
const snap = room.join('p1', 'Tester');
assert.ok(!('error' in snap));
const me = room.players.get('p1')!;
const put = (x: number, z: number) => room.handle('p1', 'state', { x, y: room.world.heightAt(x, z), z, ry: 0, anim: 0, held: null, dead: false });

test('harvest tree by hand then axe; tree is felled and yields wood', () => {
  const tree = room.world.nodes.find((n) => n.kind === 'tree' && Math.hypot(n.x - CAMP.x, n.z - CAMP.z) < 80)!;
  put(tree.x + 1.2, tree.z);
  events.length = 0;
  room.handle('p1', 'hit', { id: tree.id, item: null });
  assert.equal(take('loot')[0][2].items[0][0], 'wood');
  assert.equal(room.nodeHp.get(tree.id), nodeMaxHp(tree) - 1);
  let wood = 1;
  for (let i = 0; i < 10 && !room.depleted.has(tree.id); i++) { events.length = 0; room.handle('p1', 'hit', { id: tree.id, item: 'axe' }); wood += take('loot')[0][2].items[0][1]; }
  assert.ok(room.depleted.has(tree.id));
  assert.equal(wood, nodeMaxHp(tree) + 2);
  assert.equal(room.world.nodeColliders.get(tree.id)!.on, false);
  events.length = 0;
  room.handle('p1', 'hit', { id: tree.id, item: 'axe' });
  assert.equal(take('loot').length, 0, 'no loot from a felled tree');
});

test('cannot harvest from far away', () => {
  const tree = room.world.nodes.find((n) => n.kind === 'tree' && Math.hypot(n.x - me.x, n.z - me.z) > 40 && !room.depleted.has(n.id))!;
  events.length = 0;
  room.handle('p1', 'hit', { id: tree.id, item: 'axe' });
  assert.equal(events.length, 0);
});

test('pickups and crates', () => {
  for (const kind of ['stone', 'stick', 'fiber', 'berry', 'crate']) {
    const n = room.world.nodes.find((q) => q.kind === kind && !q.special)!;
    room.handle('p1', 'state', { x: n.x + 0.5, y: n.y, z: n.z, ry: 0, anim: 0 });
    events.length = 0;
    room.handle('p1', 'pick', { id: n.id });
    const loot = take('loot');
    assert.equal(loot.length, 1, kind);
    assert.ok(loot[0][2].items.length >= 1 && loot[0][2].items[0][1] >= 1);
    events.length = 0;
    room.handle('p1', 'pick', { id: n.id });
    assert.equal(take('loot').length, 0, kind + ' cannot be looted twice');
  }
});

test('building: placement rules, campfire, foundation, wall, door, chest', () => {
  let bx = 0, bz = 0;
  search: for (let r = 18; r < 60; r += 3) for (let a = 0; a < 6.28; a += 0.3) {
    bx = CAMP.x + Math.cos(a) * r; bz = CAMP.z + Math.sin(a) * r;
    const h = room.world.heightAt(bx, bz);
    if (checkPlacement(room.world, [], 'foundation', bx, bz, 0, h).ok && !room.world.colliders.overlaps(bx, bz, 7, -99, 99)) break search;
  }
  put(bx - 2, bz);
  assert.equal(checkPlacement(room.world, [], 'campfire', BRIDGE.x, BRIDGE.z - 0, 0, -3).ok, false, 'no building in water');
  events.length = 0;
  room.handle('p1', 'build', { type: 'foundation', x: bx, z: bz, rot: 0, req: 1 });
  const built = take('built');
  assert.equal(built.length, 1, JSON.stringify(take('buildFail')[0]?.[2]));
  const f = built[0][2].b;
  events.length = 0;
  room.handle('p1', 'build', { type: 'foundation', x: bx + 1, z: bz, rot: 0, req: 2 });
  assert.equal(take('buildFail').length, 1, 'overlapping foundation rejected');
  // stand on the foundation and place a wall, a door and a chest
  room.handle('p1', 'state', { x: bx, y: f.y, z: bz, ry: 0, anim: 0 });
  assert.equal(room.world.groundAt(bx, bz, f.y), f.y);
  for (const [type, x, z, rot] of [['wall', bx, bz - 2, 0], ['door', bx, bz + 2, 0], ['chest', bx + 0.8, bz, 0], ['campfire', bx - 5, bz + 4, 0]] as const) {
    events.length = 0;
    room.handle('p1', 'build', { type, x, z, rot, req: 3 });
    assert.equal(take('built').length, 1, type + ' ' + JSON.stringify(take('buildFail')[0]?.[2]));
  }
  const door = [...room.buildings.values()].find((b) => b.type === 'door')!;
  const probe = { x: door.x, z: door.z - 0.05 };
  assert.ok(room.world.colliders.resolve(probe, 0.3, f.y), 'closed door blocks');
  room.handle('p1', 'door', { id: door.id });
  const probe2 = { x: door.x, z: door.z - 0.05 };
  assert.equal(room.world.colliders.resolve(probe2, 0.3, f.y), false, 'open door lets through');
  const chest = [...room.buildings.values()].find((b) => b.type === 'chest')!;
  room.handle('p1', 'chestPut', { id: chest.id, item: 'wood', n: 120 });
  assert.deepEqual(chest.items!.slice(0, 2), [['wood', 99], ['wood', 21]]);
  events.length = 0;
  room.handle('p1', 'chestTake', { id: chest.id, slot: 0 });
  assert.deepEqual(take('loot')[0][2].items, [['wood', 99]]);
  assert.equal(chest.items![0], null);
  events.length = 0;
  room.handle('p1', 'demolish', { id: chest.id });
  assert.ok(take('loot')[0][2].items.some((s: any) => s[0] === 'wood' && s[1] === 21), 'chest contents returned');
});

test('enemy AI: wolf detects, chases, attacks; can be killed and drops meat', () => {
  room.handle('p1', 'debug', { clearEnemies: true });
  const x = CAMP.x - 30, z = CAMP.z + 40;
  put(x, z);
  const wolf = room.spawnEnemy('wolf', x + 10, z, -1);
  events.length = 0;
  let hurt = 0;
  for (let i = 0; i < 20 * 8 && !hurt; i++) { room.tick(0.05); hurt = take('hurt').length; }
  assert.ok(hurt > 0, `wolf should attack (dist ${Math.hypot(wolf.x - x, wolf.z - z).toFixed(1)}, state ${wolf.state})`);
  assert.equal(take('hurt')[0][2].dmg, 8);
  events.length = 0;
  for (let i = 0; i < 5; i++) room.handle('p1', 'attack', { id: wolf.id, item: 'spear' });
  assert.equal(wolf.state, 'dead');
  assert.ok(take('loot').some((l) => l[2].items[0][0] === 'raw_meat'));
});

test('deer flees from the player', () => {
  room.handle('p1', 'debug', { clearEnemies: true });
  const x = CAMP.x - 30, z = CAMP.z + 40;
  const deer = room.spawnEnemy('deer', x + 8, z, -1);
  const d0 = Math.hypot(deer.x - x, deer.z - z);
  for (let i = 0; i < 60; i++) room.tick(0.05);
  assert.ok(Math.hypot(deer.x - x, deer.z - z) > d0 + 5);
});

test('night spawns stalkers; they burn at dawn', () => {
  room.handle('p1', 'debug', { clearEnemies: true, time: 23 });
  put(CAMP.x - 60, CAMP.z + 60);
  for (let i = 0; i < 20 * 30; i++) room.tick(0.05);
  assert.ok(room.enemies.some((e) => e.type === 'stalker'), 'stalker spawned at night');
  room.handle('p1', 'debug', { time: 8 });
  for (let i = 0; i < 20 * 12; i++) room.tick(0.05);
  assert.ok(!room.enemies.some((e) => e.type === 'stalker'), 'stalkers gone by day');
});

test('weather changes over time and day counter advances', () => {
  const seen = new Set<string>();
  const d0 = room.day;
  for (let i = 0; i < 20 * 60 * 30; i++) { room.tick(0.05); seen.add(room.weather); }
  assert.ok(seen.size >= 3, 'weather types seen: ' + [...seen].join(','));
  assert.ok(room.day > d0);
});

test('radio: install parts, activate, transmission completes -> win', () => {
  room.handle('p1', 'debug', { clearEnemies: true, time: 10 });
  put(STATION.x, STATION.z + 3);
  events.length = 0;
  room.handle('p1', 'radio', { action: 'activate' });
  assert.equal(room.radio.state, 'broken');
  for (const part of ['battery', 'cable', 'tube']) room.handle('p1', 'radio', { action: 'install', part });
  assert.equal(room.radio.state, 'ready');
  room.handle('p1', 'radio', { action: 'activate' });
  assert.equal(room.radio.state, 'tx');
  for (let i = 0; i < 20 * (TX_DURATION + 2); i++) room.tick(0.05);
  assert.equal(room.radio.state, 'done');
  assert.equal(take('win').length, 1);
  assert.ok(room.enemies.some((e) => e.wave), 'defence waves were spawned');
});

test('save / load keeps world changes', () => {
  const save = JSON.parse(JSON.stringify(room.serialize()));
  const r2 = new Room('T2', () => {}, new World(), save);
  assert.equal(r2.buildings.size, room.buildings.size);
  assert.equal(r2.depleted.size, room.depleted.size);
  assert.equal(r2.radio.state, 'done');
  const f = [...r2.buildings.values()].find((b) => b.type === 'foundation')!;
  assert.equal(r2.world.groundAt(f.x, f.z, f.y), f.y, 'platform restored');
});

test('room capacity is 4 players', () => {
  const r = new Room('CAP', () => {}, world);
  for (let i = 0; i < 4; i++) assert.ok(!('error' in r.join('p' + i, 'n' + i)));
  assert.ok('error' in r.join('p5', 'n5'));
  r.leave('p0');
  assert.ok(!('error' in r.join('p6', 'n6')));
});

console.log(`\n${passed} simulation tests passed`);
