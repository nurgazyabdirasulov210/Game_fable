// In-game DOM interface: HUD, inventory, crafting, building, chest, pause, death, victory, map.
import { BUILDS, CHEST_SLOTS, ITEMS, RECIPES, type BuildType, type Cost, type ItemId, type Stack } from '../../shared/items';
import type { WeatherType } from '../../shared/room';
import { HOTBAR, type Inventory } from '../inventory';
import type { Settings } from '../settings';
import { BUILD_ICON, ITEM_ICON, UI_ICON } from './icons';

export type Panel = null | 'inv' | 'build' | 'chest' | 'pause' | 'settings' | 'death' | 'win' | 'map' | 'chat';

export interface HudCallbacks {
  craft(id: ItemId): void;
  useSlot(i: number): void;
  selectBuild(t: BuildType): void;
  chestPut(invSlot: number): void;
  chestTake(slot: number): void;
  resume(): void;
  save(): void;
  exitToMenu(): void;
  respawn(): void;
  settingsChanged(): void;
  chat(text: string): void;
  panelChanged(p: Panel): void;
  sfx(kind: 'ui' | 'hover'): void;
}

const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as T;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const WEATHER_NAME: Record<WeatherType, string> = { clear: 'Ясно', rain: 'Дождь', fog: 'Туман', storm: 'Гроза' };

export function costChips(cost: Cost, inv: Inventory | null): string {
  return Object.entries(cost).map(([k, v]) => {
    const have = inv ? inv.count(k as ItemId) : Infinity;
    return `<span class="chip ${have >= (v as number) ? '' : 'lack'}" title="${ITEMS[k as ItemId].name}">${ITEM_ICON[k as ItemId]}<b>${v}</b>${inv ? `<i>/${Math.min(have, 999)}</i>` : ''}</span>`;
  }).join('');
}

export function settingsForm(s: Settings, onChange: () => void, sfx: () => void): HTMLElement {
  const f = el(`<div class="settings">
    <label><span>Общая громкость</span><input type="range" min="0" max="1" step="0.05" data-k="master"><em></em></label>
    <label><span>Музыка</span><input type="range" min="0" max="1" step="0.05" data-k="music"><em></em></label>
    <label><span>Чувствительность мыши</span><input type="range" min="0.3" max="2.5" step="0.05" data-k="sens"><em></em></label>
    <label><span>Качество графики</span><select data-k="quality"><option value="low">Низкое</option><option value="medium">Среднее</option><option value="high">Высокое</option></select><em></em></label>
    <label class="check"><span>Инвертировать ось Y</span><input type="checkbox" data-k="invertY"><em></em></label>
    <label class="check"><span>Показывать FPS</span><input type="checkbox" data-k="showFps"><em></em></label>
    <p class="hint">Качество графики применяется при следующем запуске игры (тени, плотность травы, разрешение).</p>
  </div>`);
  f.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
    const k = inp.dataset.k as keyof Settings;
    const out = inp.parentElement!.querySelector('em')!;
    const show = () => { out.textContent = inp instanceof HTMLInputElement && inp.type === 'range' ? Math.round(Number(inp.value) * 100) + '%' : ''; };
    if (inp instanceof HTMLInputElement && inp.type === 'checkbox') inp.checked = !!s[k]; else inp.value = String(s[k]);
    show();
    inp.addEventListener('input', () => {
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') (s as any)[k] = inp.checked;
      else if (inp instanceof HTMLSelectElement) (s as any)[k] = inp.value;
      else (s as any)[k] = Number(inp.value);
      show(); onChange();
    });
    inp.addEventListener('change', sfx);
  });
  return f;
}

export const CONTROLS_HTML = `<div class="controls">
  <div><kbd>W A S D</kbd><span>Движение</span></div><div><kbd>Shift</kbd><span>Бег</span></div>
  <div><kbd>Space</kbd><span>Прыжок</span></div><div><kbd>E</kbd><span>Взаимодействие</span></div>
  <div><kbd>F</kbd><span>Набрать воду</span></div><div><kbd>ЛКМ</kbd><span>Удар / использовать</span></div>
  <div><kbd>1–6</kbd><span>Быстрые слоты</span></div><div><kbd>Tab</kbd><span>Инвентарь и крафт</span></div>
  <div><kbd>B</kbd><span>Строительство</span></div><div><kbd>R</kbd><span>Повернуть постройку</span></div>
  <div><kbd>X</kbd><span>Разобрать (с молотком)</span></div><div><kbd>M</kbd><span>Карта</span></div>
  <div><kbd>Enter</kbd><span>Чат</span></div><div><kbd>Esc</kbd><span>Меню</span></div>
</div>`;

export class Hud {
  root: HTMLElement;
  panel: Panel = null;
  private $: Record<string, HTMLElement> = {};
  private panelEl: HTMLElement;
  private selSlot: number | null = null;
  private chestItems: (Stack | null)[] | null = null;
  private lastStats = '';
  private mapDraw: ((cv: HTMLCanvasElement, full: boolean) => void) | null = null;
  private winStats = '';

  constructor(parent: HTMLElement, private inv: Inventory, private settings: Settings, private cb: HudCallbacks) {
    this.root = el(`<div id="hud">
      <div id="vignette"></div><div id="lowhp"></div>
      <div id="crosshair"></div>
      <div id="quest" class="glass"><div class="q-head">ТЕКУЩАЯ ЦЕЛЬ <span id="q-num"></span></div><div id="q-title"></div><div id="q-desc"></div><div class="q-bar"><i id="q-fill"></i></div></div>
      <div id="players"></div>
      <div id="topright"><div id="minimap-wrap"><canvas id="minimap" width="200" height="200"></canvas><span class="north">N</span></div>
        <div id="clock" class="glass"><span id="w-icon"></span><span id="clock-text"></span></div></div>
      <div id="banner"><div id="banner-title"></div><div id="banner-sub"></div></div>
      <div id="danger"></div>
      <div id="radio" class="glass"><span>ПЕРЕДАЧА СИГНАЛА</span><div class="q-bar"><i id="radio-fill"></i></div><em>Удерживайте станцию!</em></div>
      <div id="toasts"></div>
      <div id="prompt"></div>
      <div id="buildhint" class="glass"></div>
      <div id="stats"></div>
      <div id="hotbar"></div>
      <div id="chatlog"></div>
      <div id="chatbox"><input id="chat-input" maxlength="140" placeholder="Сообщение… (Enter — отправить, Esc — закрыть)"></div>
      <div id="fps"></div>
      <div id="panel"></div>
    </div>`);
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[id]').forEach((e) => (this.$[e.id] = e));
    this.panelEl = this.$.panel;
    this.$.stats.innerHTML = (['hp', 'hunger', 'thirst', 'stamina'] as const).map((k) => `<div class="stat ${k}"><span class="ic">${UI_ICON[k]}</span><div class="bar"><i id="s-${k}"></i></div><b id="v-${k}"></b></div>`).join('');
    this.root.querySelectorAll<HTMLElement>('#stats [id]').forEach((e) => (this.$[e.id] = e));
    const ci = this.$['chat-input'] as HTMLInputElement;
    ci.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = ci.value.trim(); ci.value = ''; if (t) this.cb.chat(t); this.close(); }
      else if (e.key === 'Escape') { ci.value = ''; this.close(); }
    });
    this.renderHotbar();
  }

  destroy() { this.root.remove(); }
  setMapRenderer(f: (cv: HTMLCanvasElement, full: boolean) => void) { this.mapDraw = f; }
  get minimap() { return this.$.minimap as HTMLCanvasElement; }

  // ------------------------------------------------------------ HUD widgets
  setStats(hp: number, hunger: number, thirst: number, stamina: number) {
    const key = `${hp | 0},${hunger | 0},${thirst | 0},${stamina | 0}`;
    if (key === this.lastStats) return;
    this.lastStats = key;
    const set = (k: string, v: number) => { this.$['s-' + k].style.width = Math.max(0, Math.min(100, v)) + '%'; this.$['v-' + k].textContent = String(Math.ceil(Math.max(0, v))); this.$['s-' + k].parentElement!.parentElement!.classList.toggle('low', v < 25); };
    set('hp', hp); set('hunger', hunger); set('thirst', thirst); set('stamina', stamina);
    this.$.lowhp.style.opacity = String(Math.max(0, (35 - hp) / 35) * 0.8);
  }

  private slotHtml(s: Stack | null, i: number, extra = ''): string {
    return `<div class="slot ${extra} ${s ? '' : 'empty'}" data-i="${i}" ${s ? `title="${ITEMS[s[0]].name}" draggable="true"` : ''}>${s ? ITEM_ICON[s[0]] + (s[1] > 1 ? `<b>${s[1]}</b>` : '') : ''}</div>`;
  }

  renderHotbar() {
    let h = '';
    for (let i = 0; i < HOTBAR; i++) h += this.slotHtml(this.inv.slots[i], i, i === this.inv.selected ? 'sel' : '').replace('</div>', `<u>${i + 1}</u></div>`);
    const held = this.inv.held;
    this.$.hotbar.innerHTML = `<div class="held-name">${held ? ITEMS[held].name : ''}</div><div class="slots">${h}</div>`;
    if (this.panel === 'inv') this.renderInventory();
    if (this.panel === 'chest') this.renderChest();
  }

  setQuest(q: { n: number; total: number; title: string; desc: string; cur: number; max: number } | null) {
    this.$.quest.classList.toggle('done', !q);
    if (!q) { this.$['q-num'].textContent = ''; this.$['q-title'].textContent = 'Все задания выполнены'; this.$['q-desc'].textContent = 'Помощь уже в пути. Можно продолжать выживать.'; this.$['q-fill'].style.width = '100%'; return; }
    this.$['q-num'].textContent = `${q.n}/${q.total}`;
    this.$['q-title'].textContent = q.title;
    this.$['q-desc'].textContent = q.desc + (q.max > 1 ? `  (${Math.min(q.cur, q.max)}/${q.max})` : '');
    this.$['q-fill'].style.width = (q.max ? Math.min(1, q.cur / q.max) * 100 : 0) + '%';
  }

  setPrompt(html: string | null) {
    if (this.$.prompt.dataset.h === (html ?? '')) return;
    this.$.prompt.dataset.h = html ?? '';
    this.$.prompt.innerHTML = html ?? '';
    this.$.prompt.classList.toggle('on', !!html);
  }
  setBuildHint(html: string | null) { this.$.buildhint.innerHTML = html ?? ''; this.$.buildhint.classList.toggle('on', !!html); }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'loot' = 'info', icon?: string) {
    const t = el(`<div class="toast ${kind}">${icon ? `<span class="ic">${icon}</span>` : ''}<span>${text}</span></div>`);
    this.$.toasts.appendChild(t);
    while (this.$.toasts.children.length > 6) this.$.toasts.firstElementChild!.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }
  lootToast(items: Stack[]) { for (const [id, n] of items) this.toast(`+${n} ${ITEMS[id].name}`, 'loot', ITEM_ICON[id]); }

  banner(title: string, sub = '', kind: 'info' | 'quest' | 'danger' = 'info') {
    const b = this.$.banner;
    this.$['banner-title'].textContent = title; this.$['banner-sub'].textContent = sub;
    b.className = 'on ' + kind;
    clearTimeout((b as any)._t);
    (b as any)._t = setTimeout(() => (b.className = kind), 3800);
  }
  setDanger(text: string | null) { this.$.danger.textContent = text ?? ''; this.$.danger.classList.toggle('on', !!text); }
  setRadio(p: number | null) { this.$.radio.classList.toggle('on', p !== null); if (p !== null) this.$['radio-fill'].style.width = p * 100 + '%'; }
  setClock(time: number, day: number, weather: WeatherType, night: boolean) {
    const hh = Math.floor(time), mm = Math.floor((time - hh) * 60);
    const txt = `День ${day} · ${String(hh).padStart(2, '0')}:${String(mm - (mm % 5)).padStart(2, '0')} · ${WEATHER_NAME[weather]}`;
    if (this.$['clock-text'].textContent !== txt) { this.$['clock-text'].textContent = txt; this.$['w-icon'].innerHTML = weather === 'clear' && night ? UI_ICON.moon : UI_ICON[weather]; }
  }
  setPlayers(list: { name: string; color: number; dead: boolean; me: boolean }[], code: string | null) {
    this.$.players.innerHTML = code ? `<div class="room glass">Комната <b>${code}</b> · ${list.length}/4</div>` + list.map((p) => `<div class="pl ${p.dead ? 'dead' : ''}"><i style="background:#${p.color.toString(16).padStart(6, '0')}"></i>${esc(p.name)}${p.me ? ' (вы)' : ''}${p.dead ? ' — погиб' : ''}</div>`).join('') : '';
  }
  flashDamage() { const v = this.$.vignette; v.classList.remove('hit'); void v.offsetWidth; v.classList.add('hit'); }
  setFps(text: string) { this.$.fps.textContent = text; }
  chatLine(name: string, color: number, text: string) {
    const l = el(`<div class="line"><b style="color:#${color.toString(16).padStart(6, '0')}">${esc(name)}:</b> ${esc(text)}</div>`);
    this.$.chatlog.appendChild(l);
    while (this.$.chatlog.children.length > 7) this.$.chatlog.firstElementChild!.remove();
    setTimeout(() => l.classList.add('old'), 9000);
  }

  // ------------------------------------------------------------ panels
  private setPanel(p: Panel) {
    this.panel = p;
    this.selSlot = null;
    this.root.classList.toggle('modal', !!p && p !== 'chat');
    this.$.chatbox.classList.toggle('on', p === 'chat');
    if (p !== 'chest') this.chestItems = null;
    if (!p || p === 'chat') this.panelEl.innerHTML = '';
    this.cb.panelChanged(p);
  }
  close() { if (this.panel === 'death' || this.panel === 'win') return; this.setPanel(null); }
  forceClose() { this.setPanel(null); }

  private frame(title: string, body: string, cls = ''): HTMLElement {
    const f = el(`<div class="window ${cls}"><div class="w-head"><h2>${title}</h2><button class="x" data-act="close">✕</button></div><div class="w-body">${body}</div></div>`);
    this.panelEl.innerHTML = ''; this.panelEl.appendChild(f);
    f.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b?.dataset.act === 'close') { this.cb.sfx('ui'); this.close(); }
    });
    return f;
  }

  openChat() { this.setPanel('chat'); setTimeout(() => (this.$['chat-input'] as HTMLInputElement).focus(), 0); }

  openInventory() { this.setPanel('inv'); this.renderInventory(); }

  private bindSlots(root: HTMLElement, onClick: (i: number, e: MouseEvent) => void, onContext?: (i: number) => void) {
    root.querySelectorAll<HTMLElement>('.slot').forEach((s) => {
      const i = Number(s.dataset.i);
      s.addEventListener('click', (e) => onClick(i, e));
      s.addEventListener('contextmenu', (e) => { e.preventDefault(); onContext?.(i); });
      s.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/plain', String(i)); });
      s.addEventListener('dragover', (e) => e.preventDefault());
      s.addEventListener('drop', (e) => { e.preventDefault(); const a = Number(e.dataTransfer?.getData('text/plain')); if (Number.isInteger(a)) { this.selSlot = null; this.inv.move(a, i); } });
    });
  }

  private renderInventory() {
    const inv = this.inv;
    let grid = '';
    for (let i = 0; i < inv.slots.length; i++) grid += this.slotHtml(inv.slots[i], i, (i < HOTBAR ? 'hot ' : '') + (i === this.selSlot ? 'pick' : ''));
    const sel = this.selSlot !== null ? inv.slots[this.selSlot] : null;
    const def = sel ? ITEMS[sel[0]] : null;
    const detail = def ? `<div class="detail"><div class="big">${ITEM_ICON[def.id]}</div><div><h3>${def.name}</h3><p>${def.desc}</p>${def.kind === 'food' ? '<button class="btn small" data-act="use">Использовать</button>' : ''}</div></div>`
      : '<div class="detail muted">Выберите предмет. Клик по другой ячейке — переместить. ПКМ — использовать. Первые 6 ячеек — быстрые слоты.</div>';
    const recipes = RECIPES.map((r) => {
      const ok = inv.has(r.cost), d = ITEMS[r.id];
      return `<div class="recipe ${ok ? '' : 'no'}"><div class="r-ic">${ITEM_ICON[r.id]}</div><div class="r-info"><h4>${d.name}</h4><div class="chips">${costChips(r.cost, inv)}</div></div><button class="btn small" data-craft="${r.id}" ${ok ? '' : 'disabled'}>Создать</button></div>`;
    }).join('');
    const f = this.frame('Рюкзак и ремесло', `<div class="cols"><div class="col"><h3 class="sub">Инвентарь</h3><div class="grid">${grid}</div>${detail}</div><div class="col craft"><h3 class="sub">Ремесло</h3><div class="recipes">${recipes}</div></div></div>`, 'inv');
    this.bindSlots(f, (i) => {
      if (this.selSlot === null) { if (inv.slots[i]) { this.selSlot = i; this.cb.sfx('hover'); this.renderInventory(); } }
      else if (this.selSlot === i) { this.selSlot = null; this.renderInventory(); }
      else { const a = this.selSlot; this.selSlot = null; this.cb.sfx('ui'); inv.move(a, i); }
    }, (i) => { this.selSlot = null; this.cb.useSlot(i); });
    f.querySelector('[data-act="use"]')?.addEventListener('click', () => { const i = this.selSlot; if (i !== null) { this.cb.useSlot(i); if (!inv.slots[i]) this.selSlot = null; this.renderInventory(); } });
    f.querySelectorAll<HTMLElement>('[data-craft]').forEach((b) => b.addEventListener('click', () => this.cb.craft(b.dataset.craft as ItemId)));
  }

  openBuild(hasHammer: boolean) {
    this.setPanel('build');
    const cards = BUILDS.map((b, i) => {
      const locked = b.needsHammer && !hasHammer, ok = this.inv.has(b.cost) && !locked;
      return `<button class="card ${ok ? '' : 'no'}" data-build="${b.type}" ${locked ? 'disabled' : ''}><u>${i + 1}</u><div class="c-ic">${BUILD_ICON[b.type]}</div><h4>${b.name}</h4><p>${locked ? 'Нужен строительный молоток' : b.desc}</p><div class="chips">${costChips(b.cost, this.inv)}</div></button>`;
    }).join('');
    const f = this.frame('Строительство', `<div class="cards">${cards}</div><p class="hint">Выберите постройку, затем: <kbd>ЛКМ</kbd> поставить · <kbd>R</kbd> повернуть · колесо — дистанция · <kbd>ПКМ</kbd> отмена. Стены и двери примыкают к краям фундамента.</p>`, 'build');
    f.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((b) => b.addEventListener('click', () => { this.cb.sfx('ui'); const t = b.dataset.build as BuildType; this.setPanel(null); this.cb.selectBuild(t); }));
  }

  openChest(items: (Stack | null)[]) { this.setPanel('chest'); this.chestItems = items; this.renderChest(); }
  updateChest(items: (Stack | null)[]) { if (this.panel === 'chest') { this.chestItems = items; this.renderChest(); } }
  private renderChest() {
    const items = this.chestItems ?? new Array(CHEST_SLOTS).fill(null);
    let cg = '', ig = '';
    for (let i = 0; i < CHEST_SLOTS; i++) cg += this.slotHtml(items[i] ?? null, i);
    for (let i = 0; i < this.inv.slots.length; i++) ig += this.slotHtml(this.inv.slots[i], i, i < HOTBAR ? 'hot' : '');
    const f = this.frame('Ящик', `<div class="cols"><div class="col"><h3 class="sub">Содержимое ящика</h3><div class="grid chestgrid">${cg}</div></div><div class="col"><h3 class="sub">Ваш инвентарь</h3><div class="grid invgrid">${ig}</div></div></div><p class="hint">Клик по предмету — переложить. Ящик общий для всех игроков комнаты.</p>`, 'chest');
    f.querySelectorAll<HTMLElement>('.chestgrid .slot').forEach((s) => s.addEventListener('click', () => { if (items[Number(s.dataset.i)]) { this.cb.sfx('ui'); this.cb.chestTake(Number(s.dataset.i)); } }));
    f.querySelectorAll<HTMLElement>('.invgrid .slot').forEach((s) => s.addEventListener('click', () => { if (this.inv.slots[Number(s.dataset.i)]) { this.cb.sfx('ui'); this.cb.chestPut(Number(s.dataset.i)); } }));
  }

  openPause(o: { solo: boolean; code: string | null; link: string | null }) {
    this.setPanel('pause');
    const mp = o.code ? `<div class="invite"><span>Код комнаты</span><b>${o.code}</b><button class="btn small" data-act="copy">Скопировать ссылку-приглашение</button></div>` : '';
    const f = this.frame('Пауза', `${mp}<div class="menu-list">
      <button class="btn" data-act="resume">Продолжить</button>
      ${o.solo ? '<button class="btn" data-act="save">Сохранить игру</button>' : ''}
      <button class="btn" data-act="settings">Настройки</button>
      <button class="btn danger" data-act="exit">${o.solo ? 'Сохранить и выйти в меню' : 'Покинуть комнату'}</button></div>
      <h3 class="sub">Управление</h3>${CONTROLS_HTML}${o.solo ? '' : '<p class="hint">В сетевой игре мир не ставится на паузу.</p>'}`, 'pause');
    f.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (!a || a === 'close') return;
      this.cb.sfx('ui');
      if (a === 'resume') this.close();
      else if (a === 'save') this.cb.save();
      else if (a === 'settings') this.openSettings();
      else if (a === 'exit') this.cb.exitToMenu();
      else if (a === 'copy' && o.link) { void navigator.clipboard?.writeText(o.link).then(() => this.toast('Ссылка скопирована', 'good'), () => this.toast(o.link!, 'info')); }
    });
  }

  openSettings() {
    this.setPanel('settings');
    const f = this.frame('Настройки', '', 'settings-w');
    f.querySelector('.w-body')!.appendChild(settingsForm(this.settings, () => this.cb.settingsChanged(), () => this.cb.sfx('ui')));
  }

  openMap() {
    this.setPanel('map');
    const f = this.frame('Карта долины', '<canvas id="bigmap" width="640" height="640"></canvas><p class="hint">Места отмечаются на карте после того, как вы их обнаружите.</p>', 'map');
    this.mapDraw?.(f.querySelector('canvas')!, true);
  }
  refreshMap() { const c = this.panelEl.querySelector<HTMLCanvasElement>('#bigmap'); if (c) this.mapDraw?.(c, true); }

  showDeath(cause: string) {
    this.setPanel('death');
    this.panelEl.innerHTML = '';
    const f = el(`<div class="fullscreen death"><h1>ВЫ ПОГИБЛИ</h1><p>${cause}</p><p class="muted">Вы очнётесь в лагере выживших. Инвентарь сохранится, но силы будут на исходе.</p><button class="btn big" data-act="respawn">Возродиться в лагере</button></div>`);
    this.panelEl.appendChild(f);
    f.querySelector('button')!.addEventListener('click', () => { this.cb.sfx('ui'); this.setPanel(null); this.cb.respawn(); });
  }

  showWin(statsHtml: string) {
    this.winStats = statsHtml;
    this.setPanel('win');
    this.panelEl.innerHTML = '';
    const f = el(`<div class="fullscreen win"><div class="kicker">СИГНАЛ ПРИНЯТ</div><h1>ПОМОЩЬ УЖЕ В ПУТИ</h1><p>Радиостанция Эмберфилда снова в эфире. Спасатели получили ваши координаты и вылетают на рассвете.</p><div class="winstats">${this.winStats}</div><div class="row"><button class="btn big" data-act="go">Продолжить выживание</button><button class="btn big ghost" data-act="menu">В главное меню</button></div></div>`);
    this.panelEl.appendChild(f);
    f.querySelector('[data-act="go"]')!.addEventListener('click', () => { this.cb.sfx('ui'); this.setPanel(null); });
    f.querySelector('[data-act="menu"]')!.addEventListener('click', () => { this.cb.sfx('ui'); this.setPanel(null); this.cb.exitToMenu(); });
  }
}
