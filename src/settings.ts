export interface Settings {
  master: number; music: number; sens: number;
  quality: 'low' | 'medium' | 'high';
  invertY: boolean; showFps: boolean; name: string;
}

const KEY = 'emberfield.settings.v1';
const DEF: Settings = { master: 0.8, music: 0.6, sens: 1, quality: 'medium', invertY: false, showFps: false, name: '' };

export function loadSettings(): Settings {
  try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEF }; }
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
