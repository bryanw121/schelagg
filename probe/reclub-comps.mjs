// Temporary probe 7 (branch only): vexvolleyball.com robots in full, and the league / tournament pages' content.
import { get } from '../lib/http.js';
import { writeFileSync } from 'node:fs';
const out = []; const say = (s) => { out.push(s); console.log(s); };
const rb = await get('https://vexvolleyball.com/robots.txt', { timeoutMs: 15000 });
say('## robots.txt (rules only)\n' + rb.text.split('\n').filter((l) => !/^User-agent:/i.test(l) || /\*/.test(l)).filter((l) => l.trim()).join('\n'));
for (const p of ['league', 'tournaments-2', 'koi', 'qilin', 'dragon', '6-feet-and-under-1', '6-feet-and-under']) {
  const r = await get(`https://vexvolleyball.com/${p}`, { timeoutMs: 20000 });
  const main = r.text.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? r.text;
  const text = main.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const links = [...new Set([...main.matchAll(/href=["']([^"'#]+)["']/g)].map((m) => m[1]).filter((u) => /^https?:/.test(u) && !/vexvolleyball\.com|squarespace|instagram|facebook|tiktok/.test(u)))];
  say(`\n## /${p}\n${text.slice(0, 1800)}\nlinks out: ${links.join(' ') || 'none'}`);
}
writeFileSync(process.env.GITHUB_STEP_SUMMARY || 'probe.md', out.join('\n') + '\n', { flag: 'a' });
