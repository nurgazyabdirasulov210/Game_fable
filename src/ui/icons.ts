// Hand-drawn flat SVG icons for items, builds and HUD.
import type { BuildType, ItemId } from '../../shared/items';

const svg = (body: string) => `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const ITEM_ICON: Record<ItemId, string> = {
  wood: svg('<g transform="rotate(-24 24 24)"><rect x="5" y="13" width="38" height="10" rx="5" fill="#a8683a"/><rect x="5" y="25" width="38" height="10" rx="5" fill="#8a5230"/><ellipse cx="41" cy="18" rx="3" ry="5" fill="#e0b57c"/><ellipse cx="41" cy="30" rx="3" ry="5" fill="#d2a46b"/></g>'),
  stone: svg('<polygon points="8,32 13,17 26,10 39,18 42,33 30,40 14,39" fill="#7d7c92"/><polygon points="13,17 26,10 24,24" fill="#a3a2b5"/><polygon points="24,24 39,18 42,33 30,40" fill="#65647a"/>'),
  fiber: svg('<path d="M24 42C22 30 14 22 8 14M24 42C24 28 24 16 24 6M24 42C26 30 34 22 40 14M24 42C20 32 12 30 6 28M24 42C28 32 36 30 42 28" stroke="#8fbf5a" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle cx="24" cy="42" r="3" fill="#6a8f40"/>'),
  berries: svg('<path d="M24 8c6 0 10 4 12 8" stroke="#5c8a45" stroke-width="3" fill="none"/><circle cx="17" cy="25" r="8" fill="#d8324a"/><circle cx="30" cy="22" r="7" fill="#e84a5f"/><circle cx="26" cy="34" r="8" fill="#b9243a"/><circle cx="14" cy="22" r="2" fill="#ff9aa8"/><circle cx="28" cy="19" r="2" fill="#ff9aa8"/>'),
  water: svg('<path d="M24 5C16 17 11 23 11 30a13 13 0 0 0 26 0c0-7-5-13-13-25z" fill="#4fb3d9"/><path d="M17 30a7 7 0 0 0 7 7" stroke="#c9ecf8" stroke-width="3" fill="none" stroke-linecap="round"/>'),
  raw_meat: svg('<path d="M10 28c-2-10 8-19 19-17 8 1 12 9 8 16-4 8-14 12-21 9-3-1-5-4-6-8z" fill="#d9566a"/><path d="M17 27c0-6 6-10 12-9" stroke="#f5b3bd" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="12" cy="36" r="4" fill="#efe6d6"/><rect x="11" y="30" width="4" height="7" fill="#efe6d6" transform="rotate(35 13 33)"/>'),
  cooked_meat: svg('<path d="M10 28c-2-10 8-19 19-17 8 1 12 9 8 16-4 8-14 12-21 9-3-1-5-4-6-8z" fill="#9a5a2e"/><path d="M17 27c0-6 6-10 12-9" stroke="#d99a5a" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="12" cy="36" r="4" fill="#efe6d6"/><rect x="11" y="30" width="4" height="7" fill="#efe6d6" transform="rotate(35 13 33)"/>'),
  bandage: svg('<rect x="8" y="16" width="32" height="16" rx="4" fill="#efe6d6" transform="rotate(-20 24 24)"/><path d="M24 18v12M18 24h12" stroke="#d8324a" stroke-width="4"/>'),
  axe: svg('<rect x="22" y="6" width="5" height="38" rx="2" fill="#a8683a" transform="rotate(25 24 24)"/><path d="M27 7l12 3c2 6 0 12-4 15l-11-6z" fill="#9a99ad"/><path d="M39 10c2 6 0 12-4 15l-2-2c3-3 4-8 3-13z" fill="#d6d5e2"/>'),
  pickaxe: svg('<rect x="22" y="8" width="5" height="36" rx="2" fill="#a8683a" transform="rotate(25 24 24)"/><path d="M8 20C16 8 34 4 44 14 34 10 20 12 8 20z" fill="#9a99ad"/>'),
  torch: svg('<rect x="21" y="20" width="6" height="24" rx="2" fill="#8a5230" transform="rotate(12 24 30)"/><path d="M27 21c7-5 2-10 0-17-2 5-9 8-6 15z" fill="#ff8a2a"/><path d="M26 20c3-3 1-6 0-9-1 3-4 5-3 8z" fill="#ffd34a"/>'),
  hammer: svg('<rect x="22" y="14" width="5" height="30" rx="2" fill="#a8683a" transform="rotate(25 24 24)"/><rect x="14" y="6" width="24" height="12" rx="2" fill="#7d7c92" transform="rotate(25 26 12)"/>'),
  spear: svg('<rect x="22" y="12" width="4" height="34" rx="2" fill="#a8683a" transform="rotate(40 24 24)"/><polygon points="40,4 42,16 32,12" fill="#c9c8d6"/>'),
  battery: svg('<rect x="9" y="14" width="30" height="24" rx="3" fill="#3d4a54"/><rect x="14" y="9" width="6" height="6" fill="#c9c2a8"/><rect x="28" y="9" width="6" height="6" fill="#c9c2a8"/><path d="M26 18l-7 9h5l-2 8 8-10h-5z" fill="#ffd34a"/>'),
  cable: svg('<circle cx="24" cy="24" r="14" stroke="#2d3135" stroke-width="6" fill="none"/><circle cx="24" cy="24" r="14" stroke="#e8823a" stroke-width="2" fill="none" stroke-dasharray="6 5"/><rect x="34" y="34" width="9" height="5" rx="1" fill="#c9c2a8" transform="rotate(40 38 36)"/>'),
  tube: svg('<path d="M16 30V17a8 8 0 0 1 16 0v13z" fill="#bfe1ec" opacity=".85"/><rect x="14" y="30" width="20" height="7" rx="1" fill="#3d4a54"/><path d="M19 37v6M24 37v6M29 37v6" stroke="#c9c2a8" stroke-width="2"/><path d="M21 29V20h6v9" stroke="#ff8a2a" stroke-width="2" fill="none"/>'),
};

export const BUILD_ICON: Record<BuildType, string> = {
  campfire: svg('<path d="M8 40l32-8M8 32l32 8" stroke="#8a5230" stroke-width="5" stroke-linecap="round"/><path d="M24 34c10-6 4-14 0-26-3 9-13 14-8 24z" fill="#ff8a2a"/><path d="M24 33c4-4 2-8 0-13-2 5-6 8-4 12z" fill="#ffd34a"/>'),
  foundation: svg('<polygon points="24,12 44,22 24,32 4,22" fill="#b98248"/><polygon points="4,22 24,32 24,40 4,30" fill="#65647a"/><polygon points="44,22 24,32 24,40 44,30" fill="#7d7c92"/>'),
  wall: svg('<rect x="6" y="8" width="36" height="32" fill="#a8743f"/><path d="M15 8v32M24 8v32M33 8v32" stroke="#7a5232" stroke-width="2"/><rect x="6" y="8" width="36" height="4" fill="#7a5232"/><rect x="6" y="36" width="36" height="4" fill="#7a5232"/>'),
  door: svg('<rect x="6" y="6" width="36" height="36" fill="#7a5232"/><rect x="15" y="12" width="18" height="30" fill="#c79658"/><circle cx="29" cy="28" r="2" fill="#2f2f36"/>'),
  chest: svg('<rect x="6" y="20" width="36" height="20" rx="2" fill="#a8743f"/><path d="M6 20a18 10 0 0 1 36 0z" fill="#c08a4c"/><rect x="6" y="19" width="36" height="3" fill="#54382e"/><rect x="21" y="18" width="6" height="8" rx="1" fill="#d9b23a"/>'),
};

const stroke = (d: string) => `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${d}</svg>`;
export const UI_ICON = {
  hp: stroke('<path d="M12 21C5 15 2 12 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 4-3 7-10 13z"/>'),
  hunger: stroke('<path d="M7 2v8a2 2 0 0 0 2 2v10h2V12a2 2 0 0 0 2-2V2h-1.500v7h-1V2h-1.500v7h-1V2zM17 2c-2 2-3 5-3 8l2 2v10h2V2z"/>'),
  thirst: stroke('<path d="M12 2C8 8 5 11 5 15a7 7 0 0 0 14 0c0-4-3-7-7-13z"/>'),
  stamina: stroke('<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>'),
  clear: stroke('<circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2" stroke="currentColor" stroke-width="2"/>'),
  rain: stroke('<path d="M6 14a5 5 0 1 1 2-9 6 6 0 0 1 11 3 3.500 3.500 0 0 1-1 6z"/><path d="M8 17l-1 4M12 17l-1 4M16 17l-1 4" stroke="currentColor" stroke-width="2"/>'),
  fog: stroke('<path d="M3 8h18M5 12h14M3 16h18M7 20h10" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
  storm: stroke('<path d="M6 13a5 5 0 1 1 2-9 6 6 0 0 1 11 3 3.500 3.500 0 0 1-1 6z"/><path d="M13 14l-4 5h3l-1 4 4-6h-3z" fill="#ffd34a"/>'),
  moon: stroke('<path d="M20 14A9 9 0 0 1 10 4a8 8 0 1 0 10 10z"/>'),
};
