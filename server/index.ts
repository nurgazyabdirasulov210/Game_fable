// EMBERFIELD multiplayer server: Socket.IO rooms + static hosting of the built client.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server, type Socket } from 'socket.io';
import sirv from 'sirv';
import { Room } from '../shared/room';

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

interface Hosted { room: Room; timer: NodeJS.Timeout; emptySince: number }
const rooms = new Map<string, Hosted>();

function newCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += abc[Math.floor(Math.random() * abc.length)];
    if (!rooms.has(c)) return c;
  }
}

function createRoom(): Hosted {
  const code = newCode();
  const room = new Room(code, (to, type, data) => {
    if (to) io.to(to).emit('m', type, data); else io.to('room:' + code).emit('m', type, data);
  });
  let last = Date.now();
  const hosted: Hosted = {
    room, emptySince: 0,
    timer: setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      try { room.tick(dt); } catch (err) { console.error(`[room ${code}] tick error`, err); }
      if (room.players.size === 0) {
        if (!hosted.emptySince) hosted.emptySince = now;
        else if (now - hosted.emptySince > 5 * 60_000) { clearInterval(hosted.timer); rooms.delete(code); console.log(`[room ${code}] closed (empty)`); }
      } else hosted.emptySince = 0;
    }, TICK * 1000),
  };
  rooms.set(code, hosted);
  console.log(`[room ${code}] created`);
  return hosted;
}

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
    const h = rooms.get(code);
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
