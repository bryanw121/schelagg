// Temporary probe 5 (branch only): open Vex's club page as a signed-out visitor in a real browser,
// record what it fetches from api.reclub.co, and look for announcements in those replies and the page.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const out = []; const say = (s) => { out.push(s); console.log(s); };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const calls = [];
page.on('response', async (r) => {
  const u = r.url();
  if (!/api\.reclub\.co/.test(u)) return;
  let body = ''; try { body = await r.text(); } catch {}
  calls.push({ u, status: r.status(), body });
});
await page.goto('https://reclub.co/clubs/@vex_volleyball', { waitUntil: 'networkidle', timeout: 60000 });
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(1200); }
// Click anything that looks like an announcements tab.
for (const name of [/announcement/i, /posts?/i, /news/i]) {
  const el = page.getByText(name).first();
  if (await el.count()) { say(`clicking "${await el.innerText().catch(() => '')}"`); await el.click({ timeout: 5000 }).catch((e) => say(`  click failed: ${e.message.split('\n')[0]}`)); await page.waitForTimeout(3000); }
}
say(`## ${calls.length} api.reclub.co calls (signed out)`);
for (const c of calls) {
  const hit = /league|tournament|season|announc/i.test(c.body);
  say(`- ${c.status} ${c.u.slice(0, 160)} (${c.body.length} bytes)${hit ? ' ← mentions league/tournament/announcement' : ''}`);
  if (/announc|post|news|bulletin/i.test(c.u) || hit) say('  ' + c.body.slice(0, 1500).replace(/\s+/g, ' '));
}
const text = (await page.innerText('body')).replace(/\s+/g, ' ');
say(`\n## Page text mentions: announcement ${/announc/i.test(text)}, league ${/league/i.test(text)}, tournament ${/tournament/i.test(text)}`);
for (const w of [/announc/i, /league/i, /tournament/i]) { const m = text.match(w); if (m) say(`${w}: …${text.slice(Math.max(0, m.index - 200), m.index + 500)}…`); }
await page.screenshot({ path: 'vex.png', fullPage: true });
await browser.close();
writeFileSync(process.env.GITHUB_STEP_SUMMARY || 'probe.md', out.join('\n') + '\n', { flag: 'a' });
