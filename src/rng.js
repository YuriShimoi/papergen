/**
 * Seeded random generator, same seed always gives the same sequence.
 */
class Rng {
  /** @param {number|string} seed - text seeds are hashed */
  constructor(seed=Date.now()) {
    this.seed = seed;
    this.state = Rng.hash(seed);
  }

  //#region [ Static ]
  /** FNV-1a over the string form of the value */
  static hash(value) {
    let h = 2166136261;
    for(const ch of String(value)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  static randomSeed() {
    return Math.floor(Math.random() * 1e9);
  }
  //#endregion

  //#region [ API ]
  /** mulberry32, returns [0, 1) */
  next() {
    let t = this.state = (this.state + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max) */
  float(min=0, max=1) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max], both inclusive */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability) {
    return this.next() < probability;
  }

  pick(list) {
    return list[this.int(0, list.length - 1)];
  }

  /** Fisher-Yates, in place */
  shuffle(list) {
    for(let i = list.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  //#endregion
}
