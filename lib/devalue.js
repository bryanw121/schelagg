// Minimal reader for Nuxt's __NUXT_DATA__ payload (devalue's "flattened" format):
// a JSON array where every object/array value is an index into the same array.
// Nuxt adds its own reducers for Vue reactivity wrappers; we unwrap them to
// plain values. No eval, no code execution: only JSON.parse.

// devalue's reserved negative indices.
const SPECIAL = { '-1': undefined, '-2': undefined, '-3': NaN, '-4': Infinity, '-5': -Infinity, '-6': -0 };
// Nuxt wrappers whose payload is the wrapped value itself.
const PASSTHROUGH = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'NuxtError', 'Island']);
// Nuxt stores a falsy ref's value as a string: '_' for undefined, else a JSON literal ("false", "null", "0").
const EMPTY_REF = new Set(['EmptyRef', 'EmptyShallowRef']);

function emptyRefValue(raw) {
  if (raw === '_' || raw === undefined) return undefined;
  if (raw === '0n') return 0n;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

/** Revive a flattened devalue array (already JSON-parsed) into plain JS values. */
export function unflatten(arr) {
  if (!Array.isArray(arr)) throw new Error('devalue: payload is not an array');
  const memo = new Map();
  const get = (i) => {
    if (typeof i !== 'number') throw new Error(`devalue: bad reference ${JSON.stringify(i)}`);
    if (i < 0) return SPECIAL[i];
    if (memo.has(i)) return memo.get(i);
    if (i >= arr.length) throw new Error(`devalue: reference ${i} out of range`);
    const v = arr[i];
    if (v === null || typeof v !== 'object') { memo.set(i, v); return v; }
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') return typed(i, v);
      const out = [];
      memo.set(i, out);
      for (const x of v) out.push(get(x));
      return out;
    }
    const o = {};
    memo.set(i, o);
    for (const [k, x] of Object.entries(v)) o[k] = get(x);
    return o;
  };
  const typed = (i, v) => {
    const [t] = v;
    let r;
    if (PASSTHROUGH.has(t)) { memo.set(i, undefined); r = get(v[1]); }
    else if (EMPTY_REF.has(t)) r = emptyRefValue(get(v[1]));
    else if (t === 'Date') r = new Date(v[1]);
    else if (t === 'BigInt') r = BigInt(v[1]);
    else if (t === 'RegExp') r = new RegExp(v[1], v[2]);
    else if (t === 'Object') r = Object(v[1]);
    else if (t === 'Set') { r = new Set(); memo.set(i, r); for (let k = 1; k < v.length; k++) r.add(get(v[k])); return r; }
    else if (t === 'Map') { r = new Map(); memo.set(i, r); for (let k = 1; k < v.length; k += 2) r.set(get(v[k]), get(v[k + 1])); return r; }
    else if (t === 'null') { r = Object.create(null); memo.set(i, r); for (let k = 1; k < v.length; k += 2) r[v[k]] = get(v[k + 1]); return r; }
    else r = v[1] === undefined ? undefined : get(v[1]); // unknown custom reducer: best effort, unwrap its payload
    memo.set(i, r);
    return r;
  };
  return arr.length ? get(0) : undefined;
}

/** The revived __NUXT_DATA__ payload of a server-rendered Nuxt page, or null if the page has none. */
export function nuxtData(html) {
  const m = String(html).match(/<script\b[^>]*\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  return unflatten(JSON.parse(m[1]));
}
