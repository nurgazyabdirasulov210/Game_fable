// EMBERFIELD multiplayer server: Socket.IO rooms + static hosting of the built client.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server, type Socket } from 'socket.io';
import sirv from 'sirv';
import { Room, type RoomSave } from '../shared/room';

const PORT = Number(process.env.PORT ?? 3001);
const TICK = 1 / 20;
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const serve = existsSync(dist) ? sirv(dist, { single: true, dev: true }) : null;

const http = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size })); return; }
  if (serve) return serve(req, res, () => { res.writeHead(404); res.end('Not found'); });
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('EMBERFIELD server is running. Build the client with "npm run build" or use "npm run dev".');
});

const io = new Server(http, { cors: { origin: true }, maxHttpBufferSize: 1e5 });

interface Hosted { room: Room; timer: NodeJS.Timeout; emptySince: number; savedAt: number }
const rooms = new Map<string, Hosted>();

// ---- persistence: each room's world is stored as JSON so friends can come back to it after a restart
const DATA = process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'rooms');
const CODE_RE = /^[A-Z0-9]{5}$/;
const fileOf = (code: string) => join(DATA, code + '.json');
try {
  mkdirSync(DATA, { recursive: true });
  for (const f of readdirSync(DATA)) { const p = join(DATA, f); if (Date.now() - statSync(p).mtimeMs > 30 * 86400_000) unlinkSync(p); }
} catch (err) { console.error('cannot prepare data directory', err); }

function persist(h: Hosted) {
  try {
    const tmp = fileOf(h.room.code) + '.tmp';
    writeFileSync(tmp, JSON.stringify(h.room.serialize()));
    renameSync(tmp, fileOf(h.room.code));
    h.savedAt = Date.now();
  } catch (err) { console.error(`[room ${h.room.code}] save failed`, err); }
}

function loadStored(code: string): RoomSave | null {
  if (!CODE_RE.test(code) || !existsSync(fileOf(code))) return null;
  try { const s = JSON.parse(readFileSync(fileOf(code), 'utf8')); return s && Array.isArray(s.nodes) && Array.isArray(s.buildings) ? s : null; }
  catch (err) { console.error(`[room ${code}] stored save is unreadable`, err); return null; }
}

function newCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += abc[Math.floor(Math.random() * abc.length)];
    if (!rooms.has(c) && !existsSync(fileOf(c))) return c;
  }
}

function createRoom(code = newCode(), save?: RoomSave): Hosted {
  const room = new Room(code, (to, type, data) => {
    if (to) io.to(to).emit('m', type, data); else io.to('room:' + code).emit('m', type, data);
  }, undefined, save);
  let last = Date.now();
  const hosted: Hosted = {
    room, emptySince: 0, savedAt: Date.now(),
    timer: setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      try { room.tick(dt); } catch (err) { console.error(`[room ${code}] tick error`, err); }
      if (room.players.size === 0) {
        if (!hosted.emptySince) { hosted.emptySince = now; persist(hosted); }
        else if (now - hosted.emptySince > 5 * 60_000) { clearInterval(hosted.timer); rooms.delete(code); console.log(`[room ${code}] unloaded (empty, kept on disk)`); }
      } else {
        hosted.emptySince = 0;
        if (now - hosted.savedAt > 30_000) persist(hosted);
      }
    }, TICK * 1000),
  };
  rooms.set(code, hosted);
  console.log(`[room ${code}] ${save ? 'restored from disk' : 'created'}`);
  return hosted;
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { for (const h of rooms.values()) persist(h); process.exit(0); });

io.on('connection', (socket: Socket) => {
  let current: Hosted | null = null;

  const enter = (h: Hosted, name: unknown, ack: unknown) => {
    if (typeof ack !== 'function') return;
    if (current) { ack({ error: 'Вы уже в комнате' }); return; }
    const res = h.room.join(socket.id, String(name ?? ''));
    if ('error' in res) { ack(res); return; }
    current = h;
    socket.join('room:' + h.room.code);
    console.log(`[room ${h.room.code}] ${socket.id} joined (${h.room.players.size}/4)`);
    ack(res);
  };

  socket.on('create', (d: any, ack: unknown) => {
    if (rooms.size >= 200) { if (typeof ack === 'function') ack({ error: 'Сервер переполнен' }); return; }
    enter(createRoom(), d?.name, ack);
  });

  socket.on('join', (d: any, ack: unknown) => {
    const code = String(d?.code ?? '').toUpperCase().trim();
    let h = rooms.get(code);
    if (!h) { const stored = loadStored(code); if (stored && rooms.size < 200) h = createRoom(code, stored); }
    if (!h) { if (typeof ack === 'function') ack({ error: 'Комната не найдена' }); return; }
    enter(h, d?.name, ack);
  });

  socket.on('m', (type: unknown, data: unknown) => {
    if (!current || typeof type !== 'string' || type === 'debug') return;
    try { current.room.handle(socket.id, type, data); } catch (err) { console.error('handle error', type, err); }
  });

  socket.on('disconnect', () => {
    if (current) {
      current.room.leave(socket.id);
      console.log(`[room ${current.room.code}] ${socket.id} left (${current.room.players.size}/4)`);
    }
    current = null;
  });
});

http.listen(PORT, () => console.log(`EMBERFIELD server listening on http://localhost:${PORT}${serve ? ' (serving dist/)' : ''}`));
