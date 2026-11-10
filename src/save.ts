import type { RoomSave } from '../shared/room';
import type { Stack } from '../shared/items';

export interface PlayerSave {
  x: number; y: number; z: number; yaw: number;
  hp: number; hunger: number; thirst: number; stamina: number;
  slots: (Stack | null)[]; selected: number;
  quest: number; counters: Record<string, number>; discovered: string[];
  stats: { kills: number; crafted: number; built: number; deaths: number; playtime: number };
  won: boolean;
}
export interface SaveGame { v: 1; name: string; savedAt: number; room: RoomSave; player: PlayerSave }

const KEY = 'emberfield.save.v1';

export function loadSave(): SaveGame | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return s && s.v === 1 && s.room && s.player ? s : null;
  } catch { return null; }
}
export function writeSave(s: SaveGame): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}
export function clearSave() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

// ---- co-op: the world lives on the server; personal progress is kept per room code
export interface MpSave { v: 1; code: string; name: string; savedAt: number; player: PlayerSave }
const MP_KEY = 'emberfield.mp.';
const MP_LAST = 'emberfield.mp.last';

export function loadMpSave(code: string): MpSave | null {
  try { const s = JSON.parse(localStorage.getItem(MP_KEY + code) ?? 'null'); return s && s.v === 1 && s.player ? s : null; } catch { return null; }
}
export function writeMpSave(s: MpSave): boolean {
  try { localStorage.setItem(MP_KEY + s.code, JSON.stringify(s)); localStorage.setItem(MP_LAST, s.code); return true; } catch { return false; }
}
export function lastMpRoom(): MpSave | null {
  try { const c = localStorage.getItem(MP_LAST); return c ? loadMpSave(c) : null; } catch { return null; }
}
