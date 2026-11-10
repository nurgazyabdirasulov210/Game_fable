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
