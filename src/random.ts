/** Deterministic random helpers shared by model rules and mesh builders. */
export function rng(seed: number) {
  let s = (Math.floor(seed * 2654435761) >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export const hsh = (x: number) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
