// Node.js release schedule (https://github.com/nodejs/Release). Majors with LTS codenames and end-of-life dates.
export const RELEASES = {
  12: { codename: 'erbium', eol: '2022-04-30' }, 14: { codename: 'fermium', eol: '2023-04-30' }, 15: { eol: '2021-06-01' },
  16: { codename: 'gallium', eol: '2023-09-11' }, 17: { eol: '2022-06-01' }, 18: { codename: 'hydrogen', eol: '2025-04-30' }, 19: { eol: '2023-06-01' },
  20: { codename: 'iron', eol: '2026-04-30' }, 21: { eol: '2024-06-01' }, 22: { codename: 'jod', eol: '2027-04-30' }, 23: { eol: '2025-06-01' },
  24: { codename: 'krypton', eol: '2028-04-30' }, 25: { eol: '2026-06-01' }, 26: { codename: null, eol: '2029-04-30' }, 27: { eol: '2027-06-01' },
};
const ltsMajors = Object.entries(RELEASES).filter(([, r]) => r.codename !== undefined).map(([m]) => +m);
/** Latest LTS major on a date (even majors become LTS in October of their release year). */
export function latestLts(now = new Date()) {
  const y = now.getUTCFullYear(); const m = now.getUTCMonth();
  // major N (even) is released April of year 2015 + N/2 + ... ; becomes LTS in late October that year
  const candidates = ltsMajors.filter((M) => { const yr = 2023 + (M - 20) / 2; return yr < y || (yr === y && m >= 9 && now.getUTCDate() >= 28) || (yr === y && m > 9); });
  return Math.max(...candidates);
}
export function currentMajor(now = new Date()) { const y = now.getUTCFullYear(); const m = now.getUTCMonth(); return m >= 9 ? 2 * (y - 2023) + 21 : m >= 3 ? 2 * (y - 2023) + 20 : 2 * (y - 2024) + 21; }
export const isEol = (major, now = new Date()) => { const r = RELEASES[major]; return r ? Date.parse(r.eol) <= now.getTime() : major < 12; };

/** Resolve a version spec from nvmrc/setup-node/matrix into a major number, or null. */
export function toMajor(spec, now = new Date()) {
  const s = String(spec ?? '').trim().replace(/^['"]|['"]$/g, '').replace(/^v/, '').toLowerCase();
  if (!s) return null;
  let m = /^(\d+)(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?$/.exec(s); if (m) return +m[1];
  m = /^(?:>=|\^|~)\s*(\d+)/.exec(s); if (m) return +m[1];
  if (s === 'lts/*' || s === 'lts' || s === 'lts/-0') return latestLts(now);
  m = /^lts\/-(\d+)$/.exec(s); if (m) { const l = latestLts(now); return l - 2 * +m[1]; }
  m = /^lts\/([a-z]+)$/.exec(s); if (m) { const e = Object.entries(RELEASES).find(([, r]) => r.codename === m[1]); return e ? +e[0] : null; }
  if (['node', 'latest', 'current', 'stable'].includes(s)) return currentMajor(now);
  return null;
}
