// robots.txt, enough to answer "may a general crawler read this path?" before a page becomes a
// source: the rules for `User-agent: *` (other groups are ignored: we are none of the named bots),
// longest matching Allow / Disallow wins, Allow wins a tie, `*` and a trailing `$` are honoured.
// Pure; used by scripts/try-event-pages.mjs.

/** The Allow / Disallow rules of the `*` group(s): [{ allow, path }]. */
export function starRules(text) {
  const rules = [];
  let inStar = false, lastWasAgent = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === 'user-agent') { inStar = lastWasAgent ? inStar || value === '*' : value === '*'; lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (inStar && (key === 'allow' || key === 'disallow') && value) rules.push({ allow: key === 'allow', path: value });
  }
  return rules;
}
const toRegex = (path) => new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
/** May a general crawler read `pathAndQuery` ("/events/?page=2") under this robots.txt? No rules: yes. */
export function robotsAllows(text, pathAndQuery) {
  let best = null;
  for (const r of starRules(text)) {
    if (!toRegex(r.path).test(pathAndQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}
