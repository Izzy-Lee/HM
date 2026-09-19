/* 2026-09-19 현장: 예약(300자)은 되는데 설문(1,500자)은 '요청이 닿지 않음' 으로 실패했다.
   Apps Script 는 요청을 다른 주소로 넘기면서 주소가 더 길어지고, 그 과정에서 잘린다.
   진짜 한계가 얼마인지는 밖에서 알 수 없다. 그래서 설문 화면은 실패하면 반으로 쪼개
   다시 보낸다. 여기서는 하네스가 일정 길이 넘는 요청을 끊어버리게 해놓고,
   그래도 답변이 하나도 빠짐없이 시트에 남는지 본다. */
const { chromium } = require('playwright');
const BASE = process.env.HM_BASE || 'http://127.0.0.1:8870';
const ok = (c, m) => { console.log((c ? '  ✅' : '  ❌') + ' ' + m); if (!c) process.exitCode = 1; };
const dump = async (page, tab) =>
  page.evaluate(u => fetch(u).then(r => r.json()).catch(() => null),
                BASE + '/_dump?tab=' + encodeURIComponent(tab));
const bare = v => String(v).replace(/\s*\(이어짐 \d+\)\s*$/, '').trim();

function merge(rows, name) {
  const head = rows[0], i = head.indexOf('이름'), out = {};
  rows.slice(1).forEach(r => {
    if (bare(r[i]) !== name) return;
    head.forEach((h, j) => { if (String(r[j]).trim() !== '') out[h] = r[j]; });
  });
  return out;
}

async function fill(page, type, opts = {}) {
  await page.goto(BASE + '/survey.html?t=' + type +
    (opts.slot ? '&slot=' + encodeURIComponent(opts.slot) : '') +
    (opts.name ? '&name=' + encodeURIComponent(opts.name) : ''), { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  let g = 0;
  while (g++ < 20) {
    if (await page.locator('.done').count()) break;
    for (const c of await page.locator('.q').all()) {
      const sc = await c.locator('.scale').all();
      if (sc.length) { for (const x of sc) await x.locator('button').first().click(); continue; }
      const o = await c.locator('.opt').all();
      if (o.length) { if (!(await c.locator('.opt.on').count())) await o[0].click(); continue; }
      const ta = c.locator('textarea');
      if (await ta.count()) await ta.fill('좋'.repeat(opts.long || 12));
      for (const sh of await c.locator('input[data-t]').all()) {
        const t = (await sh.getAttribute('data-t')) || '';
        if (t.includes('이름')) await sh.fill(opts.name || '테스트');
        else if (t.includes('링크')) await sh.fill('https://instagram.com/p/hm0919');
        else await sh.fill('10,000원');
      }
    }
    await page.locator('#bNext').click();
    await page.waitForTimeout(500);
  }
  await page.waitForSelector('.done', { timeout: 60000 });
  const sent = await page.evaluate(() => JSON.parse(JSON.stringify(A)));
  const why = (await page.locator('.pend .why').count())
    ? (await page.locator('.pend .why').textContent()).trim() : '';
  return { pend: (await page.locator('.pend').count()) > 0, sent, why };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const lens = [];
  page.on('request', r => { if (r.url().includes('action=survey')) lens.push(r.url().length); });

  const cap = Number(process.env.MAX_URL || 0);
  console.log('\n═══ 주소 ' + cap + '자 넘으면 끊기는 서버에서 ═══');

  const r = await fill(page, 'coloring', { slot: '컬러링 15:00', name: '한계테스트', long: 90 });
  const rows = await dump(page, '설문_컬러링체험');
  ok(!!rows, '설문 탭이 만들어짐');
  ok(!r.pend, '전송 대기 없음' + (r.why ? ' — ' + r.why : ''));
  if (lens.some(l => l > cap)) ok(true, '한계를 넘는 요청을 시도했다가 막히고 (' + Math.max(...lens) + '자) 쪼갬');
  else console.log('    (한계 ' + cap + '자를 넘는 요청은 없었음 — 가장 긴 것 ' + Math.max(...lens) + '자)');
  const m = merge(rows || [[]], '한계테스트');
  const missing = Object.keys(r.sent).filter(k => k !== '이름' && String(m[k] || '') === '');
  ok(missing.length === 0, '쪼개 보내서 ' + Object.keys(r.sent).length + '문항 모두 저장' +
     (missing.length ? ' — 빠짐: ' + missing.slice(0, 3).join(', ') : ''));
  const long = Object.keys(m).filter(k => /^좋+$/.test(String(m[k])) && String(m[k]).length === 90);
  ok(long.length > 0, '90자 주관식도 안 잘리고 그대로 (' + long.length + '문항)');
  console.log('    요청 ' + lens.length + '건 · 시트 ' + (rows.length - 1) + '줄');

  await browser.close();
  console.log(process.exitCode ? '\n실패 있음\n' : '\n전부 통과\n');
})();
