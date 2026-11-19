#!/usr/bin/env node
// Carry out an "add-source" issue (see api/add-source.js): read the one JSON line in its body,
// run the same check again from here, and write the config change. Nothing in the issue is
// trusted beyond { input, target, region }; what gets written is derived by lib/add-source.js.
//
//   ISSUE_BODY='…```json {"input":"…","target":"volleyball","region":"austin"} ```…' node scripts/add-source.mjs
//   node scripts/add-source.mjs '<input>' <target> <region>        the same, by hand (add --dry to only check)
//
// Prints one line of JSON: { status, title, detail, changed, file }. Exit 0 when the config was
// changed or already had it; 1 when the source can't be added (the reason is in `detail`).
import { get } from '../lib/http.js';
import { applyPlan, checkSource } from '../lib/add-source.js';
import { loadAddConfig, planFiles } from '../lib/add-source-config.js';

const args = process.argv.slice(2).filter((a) => a !== '--dry');
const dry = process.argv.includes('--dry');
let ask;
if (args.length >= 3) ask = { input: args[0], target: args[1], region: args[2] };
else {
  const m = /```json\s*(\{[^\n]*\})\s*```/.exec(process.env.ISSUE_BODY ?? '');
  try { ask = m && JSON.parse(m[1]); } catch { ask = null; }
}
const say = (o, code) => { console.log(JSON.stringify(o)); process.exit(code); };
if (!ask || typeof ask.input !== 'string' || typeof ask.target !== 'string' || typeof ask.region !== 'string') say({ status: 'no', title: "Couldn't add it.", detail: 'The request had no { input, target, region } to read.' }, 1);

const config = loadAddConfig();
const result = await checkSource(ask, { get, config });
if (result.status === 'have') say({ ...result, changed: false }, 0);
if (result.status !== 'ok') say(result, 1);
const reg = config.regions.find((r) => r.info.id === ask.region);
const { files, write, paths } = planFiles(ask.region);
const done = applyPlan({ ...result.plan, city: reg.info.name.split(',')[0] }, files);
if (done.changed && !dry) write(done.file, done.text);
say({ status: 'ok', title: result.title, detail: result.detail, label: result.label, found: result.found, changed: done.changed, file: paths[done.file] }, 0);
