// Entry point: main menu, lobby dialogs and game lifecycle.
import './style.css';
import { AudioSys } from './audio';
import { Game } from './game';
import { LocalTransport, SocketTransport, type Transport } from './net';
import { clearSave, loadSave } from './save';
import { loadSettings, saveSettings } from './settings';
import { CONTROLS_HTML, settingsForm } from './ui/hud';
import { startMenuBackground } from './ui/menubg';

const settings = loadSettings();
const audio = new AudioSys();
const view = document.getElementById('view')!;
const screens = document.getElementById('screens')!;
let game: Game | null = null;
let stopBg: (() => void) | null = null;

const el = <T extends HTMLElement = HTMLElement>(html: string): T => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as T; };
const persist = () => { saveSettings(settings); audio.setVolumes(settings.master, settings.music); };
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30)));

function gesture() {
  audio.init();
  audio.setVolumes(settings.master, settings.music);
  if (!game && !audio.musicPlaying) audio.startMusic();
}
window.addEventListener('pointerdown', gesture);
window.addEventListener('keydown', gesture);

function closeDialog() { screens.querySelector('.dialog-wrap')?.remove(); }

function dialog(title: string, body: string): HTMLElement {
  closeDialog();
  const d = el(`<div class="dialog-wrap"><div class="window dialog"><div class="w-head"><h2>${title}</h2><button class="x">✕</button></div><div class="w-body">${body}</div></div></div>`);
  d.querySelector('.x')!.addEventListener('click', () => { audio.ui(); closeDialog(); });
  d.addEventListener('mousedown', (e) => { if (e.target === d) closeDialog(); });
  screens.appendChild(d);
  return d;
}

function showLoading(text: string) {
  screens.querySelector('.loading')?.remove();
  screens.appendChild(el(`<div class="loading"><div class="spinner"></div><div>${text}</div></div>`));
}
const hideLoading = () => screens.querySelector('.loading')?.remove();

function fmtSave(): string {
  const s = loadSave();
  if (!s) return 'Нет сохранения';
  const d = new Date(s.savedAt);
  return `${s.name} · день ${s.room.day} · ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

function showMenu(notice?: string) {
  screens.innerHTML = '';
  const hasSave = !!loadSave();
  const m = el(`<div class="menu">
    <canvas class="menu-bg"></canvas>
    <div class="menu-shade"></div>
    <div class="menu-main">
      <div class="logo"><span class="flame"></span><h1>EMBER<b>FIELD</b></h1><p>Кооперативное выживание в затерянной долине</p></div>
      <nav>
        <button class="mbtn" data-a="new"><span>Новая игра</span><i>Одиночное выживание</i></button>
        <button class="mbtn" data-a="continue" ${hasSave ? '' : 'disabled'}><span>Продолжить</span><i>${fmtSave()}</i></button>
        <button class="mbtn" data-a="friends"><span>Играть с друзьями</span><i>Кооператив до 4 игроков</i></button>
        <button class="mbtn" data-a="settings"><span>Настройки</span><i>Звук, управление, графика</i></button>
        <button class="mbtn" data-a="exit"><span>Выход</span><i>Завершить сессию</i></button>
      </nav>
    </div>
    <div class="menu-foot">Прототип 0.1 · WASD — движение · Tab — рюкзак · B — строительство</div>
    ${notice ? `<div class="notice">${notice}</div>` : ''}
  </div>`);
  screens.appendChild(m);
  stopBg?.();
  stopBg = startMenuBackground(m.querySelector('canvas')!);
  m.querySelectorAll<HTMLButtonElement>('.mbtn').forEach((b) => {
    b.addEventListener('mouseenter', () => audio.uiHover());
    b.addEventListener('click', () => { audio.ui(); ({ new: newGameDialog, continue: () => void start('continue').then((e) => { if (e) showMenu(e); }), friends: () => friendsDialog(), settings: settingsDialog, exit: exitDialog } as Record<string, () => void>)[b.dataset.a!](); });
  });
  const room = new URLSearchParams(location.search).get('room');
  if (room && !notice) friendsDialog(room.toUpperCase());
}

function nameField(): string {
  return `<label class="field"><span>Имя выжившего</span><input id="pname" maxlength="16" value="${(settings.name || 'Выживший').replace(/"/g, '')}" autocomplete="off"></label>`;
}
function readName(d: HTMLElement): string {
  const v = (d.querySelector<HTMLInputElement>('#pname')?.value ?? '').trim() || 'Выживший';
  settings.name = v; saveSettings(settings);
  return v;
}

function newGameDialog() {
  const has = !!loadSave();
  const d = dialog('Новая игра', `${nameField()}
    <p class="story">После катастрофы связь с внешним миром оборвалась. Вы очнулись в лагере выживших посреди долины Эмберфилд. Соберите припасы, постройте убежище и восстановите радиостанцию, чтобы вызвать помощь.</p>
    ${has ? '<p class="warn">Внимание: существующее сохранение будет перезаписано.</p>' : ''}
    <div class="row end"><button class="btn ghost" data-a="cancel">Отмена</button><button class="btn" data-a="go">Начать выживание</button></div>`);
  d.querySelector('[data-a="cancel"]')!.addEventListener('click', () => { audio.ui(); closeDialog(); });
  d.querySelector('[data-a="go"]')!.addEventListener('click', () => { audio.ui(); const n = readName(d); clearSave(); void start('new', n).then((e) => { if (e) showMenu(e); }); });
}

function friendsDialog(prefill = '') {
  const d = dialog('Играть с друзьями', `${nameField()}
    <div class="mp-cols">
      <div class="mp-card"><h3>Создать комнату</h3><p>Вы получите код комнаты и ссылку-приглашение для друзей.</p><button class="btn" data-a="create">Создать комнату</button></div>
      <div class="mp-card"><h3>Войти по коду</h3><label class="field"><span>Код комнаты</span><input id="rcode" maxlength="5" placeholder="ABCDE" value="${prefill.replace(/[^A-Z0-9]/g, '')}" autocomplete="off"></label><button class="btn" data-a="join">Присоединиться</button></div>
    </div>
    <p class="err" id="mp-err"></p>
    <p class="hint">Общий мир: ресурсы, постройки, враги, время суток и погода синхронизируются сервером. Требуется запущенный сервер игры (<code>npm run dev</code> или <code>npm start</code>).</p>`);
  const err = d.querySelector<HTMLElement>('#mp-err')!;
  const code = d.querySelector<HTMLInputElement>('#rcode')!;
  code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  const go = async (mode: 'create' | 'join') => {
    audio.ui();
    if (mode === 'join' && code.value.length < 5) { err.textContent = 'Введите код комнаты из 5 символов'; audio.error(); return; }
    err.textContent = '';
    const e = await start(mode, readName(d), code.value);
    if (e) { const again = screens.querySelector<HTMLElement>('#mp-err'); if (again) again.textContent = e; audio.error(); }
  };
  d.querySelector('[data-a="create"]')!.addEventListener('click', () => void go('create'));
  d.querySelector('[data-a="join"]')!.addEventListener('click', () => void go('join'));
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') void go('join'); });
}

function settingsDialog() {
  const d = dialog('Настройки', '');
  const body = d.querySelector('.w-body')!;
  body.appendChild(settingsForm(settings, persist, () => audio.ui()));
  body.appendChild(el(`<div><h3 class="sub">Управление</h3>${CONTROLS_HTML}</div>`));
}

function exitDialog() {
  const d = dialog('Выход', `<p>Завершить сессию? Прогресс одиночной игры уже сохранён в браузере.</p><div class="row end"><button class="btn ghost" data-a="no">Остаться</button><button class="btn danger" data-a="yes">Выйти</button></div>`);
  d.querySelector('[data-a="no"]')!.addEventListener('click', () => { audio.ui(); closeDialog(); });
  d.querySelector('[data-a="yes"]')!.addEventListener('click', () => {
    audio.ui(); audio.stopMusic(); stopBg?.(); stopBg = null;
    try { window.close(); } catch { /* browsers only allow closing script-opened tabs */ }
    screens.innerHTML = '';
    const bye = el(`<div class="fullscreen bye"><h1>До встречи в долине</h1><p>Сессия завершена. Вкладку можно закрыть.</p><button class="btn big">Вернуться в меню</button></div>`);
    bye.querySelector('button')!.addEventListener('click', () => { gesture(); showMenu(); });
    screens.appendChild(bye);
  });
}

/** Starts a game. Returns an error message on failure (the menu stays open). */
async function start(mode: 'new' | 'continue' | 'create' | 'join', name = settings.name || 'Выживший', code = ''): Promise<string | null> {
  if (game) return null;
  showLoading(mode === 'create' || mode === 'join' ? 'Подключение к серверу…' : 'Генерация мира…');
  await nextFrame();
  let transport: Transport;
  const save = mode === 'continue' ? loadSave() : null;
  try {
    if (mode === 'create' || mode === 'join') { transport = await SocketTransport.connect(mode, name, code); showLoading('Генерация мира…'); await nextFrame(); }
    else transport = new LocalTransport(save?.name ?? name, save?.room);
  } catch (e) { hideLoading(); return (e as Error).message || 'Не удалось подключиться'; }
  try {
    audio.stopMusic();
    game = new Game({
      mount: view, transport, settings, audio, name: save?.name ?? name, save: save?.player ?? null,
      onExit: (reason) => { game = null; history.replaceState(null, '', location.pathname); gesture(); showMenu(reason); },
    });
    game.onSettings = persist;
  } catch (e) {
    console.error(e);
    transport.close(); hideLoading(); game = null;
    return 'Не удалось запустить игру: ' + ((e as Error).message ?? 'ошибка WebGL');
  }
  stopBg?.(); stopBg = null;
  screens.innerHTML = '';
  if (!transport.solo) history.replaceState(null, '', `${location.pathname}?room=${transport.snapshot.code}`);
  return null;
}

showMenu();
