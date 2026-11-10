// Item, recipe, building and loot definitions shared by client and server.

export type ItemId =
  | 'wood' | 'stone' | 'fiber' | 'berries' | 'water' | 'raw_meat' | 'cooked_meat' | 'bandage'
  | 'axe' | 'pickaxe' | 'torch' | 'hammer' | 'spear'
  | 'battery' | 'cable' | 'tube';

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  stack: number;
  kind: 'resource' | 'food' | 'tool' | 'quest';
  food?: { hunger?: number; thirst?: number; health?: number };
  /** damage vs enemies / trees / rocks, and reach */
  tool?: { dmg: number; tree: number; rock: number; reach: number };
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { id: 'wood', name: 'Древесина', desc: 'Основной строительный материал.', stack: 99, kind: 'resource' },
  stone: { id: 'stone', name: 'Камень', desc: 'Прочный материал для инструментов.', stack: 99, kind: 'resource' },
  fiber: { id: 'fiber', name: 'Волокна', desc: 'Растительные волокна для верёвок и перевязок.', stack: 99, kind: 'resource' },
  berries: { id: 'berries', name: 'Ягоды', desc: 'Немного утоляют голод и жажду.', stack: 30, kind: 'food', food: { hunger: 9, thirst: 3 } },
  water: { id: 'water', name: 'Вода', desc: 'Чистая вода из реки. Утоляет жажду.', stack: 10, kind: 'food', food: { thirst: 35 } },
  raw_meat: { id: 'raw_meat', name: 'Сырое мясо', desc: 'Можно съесть сырым, но лучше пожарить на костре.', stack: 20, kind: 'food', food: { hunger: 10, health: -6 } },
  cooked_meat: { id: 'cooked_meat', name: 'Жареное мясо', desc: 'Сытная еда. Отлично утоляет голод.', stack: 20, kind: 'food', food: { hunger: 38, health: 6 } },
  bandage: { id: 'bandage', name: 'Бинт', desc: 'Восстанавливает здоровье.', stack: 10, kind: 'food', food: { health: 30 } },
  axe: { id: 'axe', name: 'Деревянный топор', desc: 'Быстро рубит деревья. Годится как оружие.', stack: 1, kind: 'tool', tool: { dmg: 18, tree: 3, rock: 1, reach: 2.7 } },
  pickaxe: { id: 'pickaxe', name: 'Каменная кирка', desc: 'Быстро дробит камень.', stack: 1, kind: 'tool', tool: { dmg: 14, tree: 1, rock: 4, reach: 2.7 } },
  torch: { id: 'torch', name: 'Факел', desc: 'Освещает путь ночью, пока находится в руке.', stack: 1, kind: 'tool', tool: { dmg: 10, tree: 1, rock: 1, reach: 2.5 } },
  hammer: { id: 'hammer', name: 'Строительный молоток', desc: 'Позволяет строить (B) и разбирать (X) постройки.', stack: 1, kind: 'tool', tool: { dmg: 10, tree: 1, rock: 1, reach: 2.5 } },
  spear: { id: 'spear', name: 'Копьё', desc: 'Оружие с большой дальностью удара.', stack: 1, kind: 'tool', tool: { dmg: 27, tree: 1, rock: 1, reach: 3.5 } },
  battery: { id: 'battery', name: 'Аккумулятор', desc: 'Деталь для радиостанции.', stack: 1, kind: 'quest' },
  cable: { id: 'cable', name: 'Антенный кабель', desc: 'Деталь для радиостанции.', stack: 1, kind: 'quest' },
  tube: { id: 'tube', name: 'Радиолампа', desc: 'Деталь для радиостанции.', stack: 1, kind: 'quest' },
};

export const HAND_TOOL = { dmg: 6, tree: 1, rock: 1, reach: 2.4 };

export type Cost = Partial<Record<ItemId, number>>;

export interface Recipe { id: ItemId; count: number; cost: Cost }

export const RECIPES: Recipe[] = [
  { id: 'axe', count: 1, cost: { wood: 5, stone: 2, fiber: 3 } },
  { id: 'pickaxe', count: 1, cost: { wood: 4, stone: 5, fiber: 3 } },
  { id: 'hammer', count: 1, cost: { wood: 3, stone: 2, fiber: 2 } },
  { id: 'torch', count: 1, cost: { wood: 2, fiber: 2 } },
  { id: 'spear', count: 1, cost: { wood: 4, stone: 2, fiber: 2 } },
  { id: 'bandage', count: 1, cost: { fiber: 3 } },
];

export type BuildType = 'foundation' | 'wall' | 'door' | 'campfire' | 'chest';

export interface BuildDef {
  type: BuildType;
  name: string;
  desc: string;
  cost: Cost;
  needsHammer: boolean;
}

export const BUILDS: BuildDef[] = [
  { type: 'campfire', name: 'Костёр', desc: 'Свет, тепло, готовка мяса. Отпугивает ночных тварей.', cost: { wood: 5, stone: 3 }, needsHammer: false },
  { type: 'foundation', name: 'Фундамент', desc: 'Ровная основа для дома 4×4 м.', cost: { wood: 6, stone: 2 }, needsHammer: true },
  { type: 'wall', name: 'Стена', desc: 'Деревянная стена. Примыкает к краям фундамента.', cost: { wood: 4 }, needsHammer: true },
  { type: 'door', name: 'Дверь', desc: 'Дверной проём с открывающейся дверью.', cost: { wood: 5, fiber: 1 }, needsHammer: true },
  { type: 'chest', name: 'Ящик', desc: 'Общее хранилище на 12 ячеек.', cost: { wood: 8, fiber: 2 }, needsHammer: false },
];

export const BUILD_BY_TYPE: Record<BuildType, BuildDef> = Object.fromEntries(BUILDS.map((b) => [b.type, b])) as Record<BuildType, BuildDef>;

export const CHEST_SLOTS = 12;

export type Stack = [ItemId, number];

/** weighted loot table for ordinary containers */
export const CRATE_LOOT: { item: ItemId; min: number; max: number; w: number }[] = [
  { item: 'wood', min: 3, max: 7, w: 5 },
  { item: 'stone', min: 2, max: 5, w: 4 },
  { item: 'fiber', min: 3, max: 6, w: 5 },
  { item: 'berries', min: 3, max: 6, w: 4 },
  { item: 'water', min: 1, max: 2, w: 4 },
  { item: 'bandage', min: 1, max: 2, w: 3 },
  { item: 'cooked_meat', min: 1, max: 2, w: 2 },
  { item: 'torch', min: 1, max: 1, w: 1 },
];
