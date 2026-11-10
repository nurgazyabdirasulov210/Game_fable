import type { Stack } from '../shared/items';
import type { RadioState } from '../shared/room';
import { STATION, TOWER, VILLAGE } from '../shared/world';

export interface QuestCtx { counters: Record<string, number>; discovered: Set<string>; radio: RadioState }
export interface QuestDef {
  title: string; desc: string; max: number;
  progress(c: QuestCtx): number;
  reward: Stack[];
  markers?: (c: QuestCtx) => { x: number; z: number }[];
}

export const QUESTS: QuestDef[] = [
  { title: 'Запас дров', desc: 'Соберите древесину: рубите деревья (ЛКМ) или подбирайте ветки (E).', max: 10, progress: (c) => c.counters.wood ?? 0, reward: [['berries', 5], ['water', 1]] },
  { title: 'Каменный век', desc: 'Соберите камень: подбирайте камни (E) или разбивайте валуны (ЛКМ).', max: 5, progress: (c) => c.counters.stone ?? 0, reward: [['fiber', 4]] },
  { title: 'Первый инструмент', desc: 'Создайте деревянный топор в меню ремесла (Tab). Волокна растут в высокой траве.', max: 1, progress: (c) => c.counters.craft_axe ?? 0, reward: [['torch', 1]] },
  { title: 'Огонь в ночи', desc: 'Постройте костёр (B). Он даёт свет, тепло и отпугивает ночных тварей.', max: 1, progress: (c) => c.counters.build_campfire ?? 0, reward: [['cooked_meat', 2], ['bandage', 2]] },
  { title: 'Голос из эфира', desc: 'Найдите исследовательскую станцию на северо-востоке, за мостом через реку.', max: 1, progress: (c) => (c.discovered.has('station') ? 1 : 0), reward: [['bandage', 2], ['water', 2]], markers: () => [STATION] },
  {
    title: 'Починить радиостанцию', desc: 'Установите в радиостанцию аккумулятор (сторожевая башня), антенный кабель (заброшенный посёлок) и радиолампу (склад станции).', max: 3,
    progress: (c) => Number(c.radio.parts.battery) + Number(c.radio.parts.cable) + Number(c.radio.parts.tube) + (c.radio.state !== 'broken' ? 3 : 0),
    reward: [['spear', 1], ['cooked_meat', 3]],
    markers: (c) => { const m = []; if (!c.radio.parts.battery) m.push(TOWER); if (!c.radio.parts.cable) m.push(VILLAGE); m.push(STATION); return m; },
  },
  { title: 'Сигнал бедствия', desc: 'Включите передатчик и удерживайте станцию, пока сигнал не будет отправлен.', max: 100, progress: (c) => (c.radio.state === 'done' ? 100 : Math.floor(c.radio.progress * 100)), reward: [], markers: () => [STATION] },
];
