import { ITEMS, type Cost, type ItemId, type Stack } from '../shared/items';

export const INV_SIZE = 24;
export const HOTBAR = 6;

export class Inventory {
  slots: (Stack | null)[] = new Array(INV_SIZE).fill(null);
  selected = 0;
  onChange: () => void = () => {};

  /** Adds items, returns the amount that did not fit. */
  add(id: ItemId, n: number): number {
    const max = ITEMS[id].stack;
    for (const s of this.slots) {
      if (n <= 0) break;
      if (s && s[0] === id && s[1] < max) { const m = Math.min(n, max - s[1]); s[1] += m; n -= m; }
    }
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      if (!this.slots[i]) { const m = Math.min(n, max); this.slots[i] = [id, m]; n -= m; }
    }
    this.onChange();
    return n;
  }
  count(id: ItemId): number {
    let c = 0;
    for (const s of this.slots) if (s && s[0] === id) c += s[1];
    return c;
  }
  has(cost: Cost): boolean {
    for (const [k, v] of Object.entries(cost)) if (this.count(k as ItemId) < (v as number)) return false;
    return true;
  }
  remove(id: ItemId, n: number): boolean {
    if (this.count(id) < n) return false;
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s[0] === id) { const m = Math.min(n, s[1]); s[1] -= m; n -= m; if (s[1] <= 0) this.slots[i] = null; }
    }
    this.onChange();
    return true;
  }
  pay(cost: Cost): boolean {
    if (!this.has(cost)) return false;
    for (const [k, v] of Object.entries(cost)) this.remove(k as ItemId, v as number);
    return true;
  }
  refund(cost: Cost) { for (const [k, v] of Object.entries(cost)) this.add(k as ItemId, v as number); }
  removeAt(i: number, n: number): Stack | null {
    const s = this.slots[i];
    if (!s) return null;
    const m = Math.min(n, s[1]);
    s[1] -= m;
    if (s[1] <= 0) this.slots[i] = null;
    this.onChange();
    return [s[0], m];
  }
  move(a: number, b: number) {
    if (a === b) return;
    const A = this.slots[a], B = this.slots[b];
    if (A && B && A[0] === B[0] && B[1] < ITEMS[A[0]].stack) {
      const m = Math.min(A[1], ITEMS[A[0]].stack - B[1]);
      B[1] += m; A[1] -= m;
      if (A[1] <= 0) this.slots[a] = null;
    } else { this.slots[a] = B; this.slots[b] = A; }
    this.onChange();
  }
  get held(): ItemId | null { return this.slots[this.selected]?.[0] ?? null; }
}
