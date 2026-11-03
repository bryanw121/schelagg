// Read JSON data embedded in public Next.js pages. Never execute page scripts.
export function pageObjects(html) {
  const chunks = [];
  for (const m of html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/gs)) {
    const value = JSON.parse(m[1]);
    if (value[0] === 1 && typeof value[1] === 'string') chunks.push(value[1]);
  }
  const objects = [];
  for (const line of chunks.join('').split('\n')) {
    try { objects.push(JSON.parse(line.slice(line.indexOf(':') + 1))); } catch { /* non-JSON Flight record */ }
  }
  if (!objects.length) throw new Error('Public calendar page data missing');
  return objects;
}

export function findObject(objects, predicate) {
  for (const x of objects) {
    if (!x || typeof x !== 'object') continue;
    if (predicate(x)) return x;
    const found = findObject(Object.values(x), predicate);
    if (found) return found;
  }
}
