// Transport abstraction: the game always talks to a Room, either in-process (solo)
// or through Socket.IO (co-op). Game code is identical for both.
import { io, type Socket } from 'socket.io-client';
import { Room, type RoomSave, type Snapshot } from '../shared/room';
import { World } from '../shared/world';

export type Handler = (type: string, data: any) => void;

export interface Transport {
  readonly solo: boolean;
  snapshot: Snapshot;
  send(type: string, data: any): void;
  onMessage(h: Handler): void;
  onDisconnect(h: (reason: string) => void): void;
  update(dt: number): void;
  close(): void;
  serialize(): RoomSave | null;
}

export class LocalTransport implements Transport {
  readonly solo = true;
  snapshot: Snapshot;
  room: Room;
  private queue: [string, any][] = [];
  private handler: Handler = () => {};
  private acc = 0;

  constructor(name: string, save?: RoomSave) {
    this.room = new Room('SOLO', (_to, type, data) => this.queue.push([type, data]), new World(), save);
    this.room.debug = true;
    const s = this.room.join('local', name);
    if ('error' in s) throw new Error(s.error);
    this.snapshot = s;
    this.queue.length = 0;
  }
  send(type: string, data: any) { this.room.handle('local', type, data); }
  onMessage(h: Handler) { this.handler = h; }
  onDisconnect() {}
  update(dt: number) {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= 0.05) { this.room.tick(0.05); this.acc -= 0.05; }
    if (this.queue.length) {
      const q = this.queue; this.queue = [];
      for (const [t, d] of q) this.handler(t, d);
    }
  }
  close() {}
  serialize() { return this.room.serialize(); }
}

export class SocketTransport implements Transport {
  readonly solo = false;
  snapshot!: Snapshot;
  private handler: Handler = () => {};
  private onDisc: (r: string) => void = () => {};
  private constructor(private socket: Socket) {}

  static connect(mode: 'create' | 'join', name: string, code?: string): Promise<SocketTransport> {
    return new Promise((resolve, reject) => {
      const url = new URLSearchParams(location.search).get('server') ?? undefined;
      const socket = url ? io(url, { transports: ['websocket', 'polling'] }) : io({ transports: ['websocket', 'polling'] });
      const t = new SocketTransport(socket);
      const timer = setTimeout(() => { socket.close(); reject(new Error('Сервер не отвечает. Запущен ли он? (npm run dev / npm start)')); }, 8000);
      socket.on('connect_error', () => { /* keep retrying until the timeout */ });
      socket.on('connect', () => {
        socket.emit(mode, { name, code }, (res: Snapshot | { error: string }) => {
          clearTimeout(timer);
          if ('error' in res) { socket.close(); reject(new Error(res.error)); return; }
          t.snapshot = res;
          socket.on('m', (type: string, data: any) => t.handler(type, data));
          socket.on('disconnect', (reason) => t.onDisc(reason));
          resolve(t);
        });
      });
    });
  }
  send(type: string, data: any) { this.socket.emit('m', type, data); }
  onMessage(h: Handler) { this.handler = h; }
  onDisconnect(h: (r: string) => void) { this.onDisc = h; }
  update() {}
  close() { this.socket.removeAllListeners(); this.socket.close(); }
  serialize() { return null; }
}
