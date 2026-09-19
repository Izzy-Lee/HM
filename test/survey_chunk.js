/* 오늘 현장에서 설문이 한 건도 안 들어온 그 사고를 그대로 재현하고, 고쳐졌는지 본다.
   확인하는 것은 화면의 '제출되었습니다' 가 아니라 시트에 실제로 남은 행이다.
   화면만 보던 지난번 테스트가 사고를 놓쳤기 때문이다. */
const { chromium } = require('playwright');
const BASE = process.env.HM_BASE || 'http://127.0.0.1:8790';
const ok = (c, m) => { console.log((c ? '  ✅' : '  ❌') + ' ' + m); if (!c) process.exitCode = 1; };

const dump = async (page, tab) =>
  page.evaluate(u => fetch(u).then(r => r.json()), BASE + '/_dump?tab=' + encodeURIComponent(tab));

/** 설문 한 건을 끝까지 채워 제출한다 */
async function fillSurvey(page, type, opts = {}) {
  const url = BASE + '/survey.html?t=' + type +
    (opts.slot ? '&slot=' + encodeURIComponent(opts.slot) : '') +
    (opts.name ? '&name=' + encodeURIComponent(opts.name) : '');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  let guard = 0;
  while (guard++ < 20) {
    if (await page.locator('.done').count()) break;
    for (const c of await page.locator('.q').all()) {
      const scales = await c.locator('.scale').all();
      if (scales.length) { for (const sc of scales) await sc.locator('button').first().click(); continue; }
      const o = await c.locator('.opt').all();
      if (o.length) { if (!(await c.locator('.opt.on').count())) await o[0].click(); continue; }
      const ta = c.locator('textarea');
      if (await ta.count()) await ta.fill(opts.long ? '가'.repeat(280) : '좋았습니다');
      const sh = c.locator('input[data-t]');
      if (await sh.count()) await sh.fill('10,000원');
    }
    await page.locator('#bNext').click();
    await page.waitForTimeout(500);
  }
  await page.waitForSelector('.done', { timeout: 20000 });
  return { pend: (await page.locator('.pend').count()) > 0 };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  /* 모든 요청 주소 길이를 잰다. Apps Script 는 2,000자쯤 넘으면 요청 자체를 못 받는다. */
  const lens = [];
  page.on('request', r => { if (r.url().includes('action=survey')) lens.push(r.url().length); });

  /* 하네스를 재사용해도 맞도록 절대 행수가 아니라 늘어난 행수로 센다 */
  await page.goto(BASE + '/survey.html', { waitUntil: 'domcontentloaded' });
  /* 탭은 첫 응답이 들어올 때 만들어지므로, 없으면 0건이고 있으면 헤더 1줄을 뺀다 */
  const body = rows => Math.max(0, ((rows || []).length) - 1);
  const base = {
    coloring: body(await dump(page, '설문_컬러링체험')),
    sns:      body(await dump(page, '설문_SNS후기')),
    sticker:  body(await dump(page, '설문_스티커구매'))
  };
  const grew = (rows, was) => body(rows) - was;

  console.log('\n═══ 1. 컬러링 설문 — 조각 전송 후 시트에 행이 남는가 ═══');
  const r1 = await fillSurvey(page, 'coloring', { slot: '컬러링 13:30', name: '조각테스트A', long: true });
  const rows1 = await dump(page, '설문_컬러링체험');
  ok(lens.length > 1, '여러 조각으로 나뉘어 전송됨 (조각 ' + lens.length + '개)');
  ok(Math.max(...lens) < 2000, '가장 긴 요청 주소 ' + Math.max(...lens) + '자 < 2,000자 (Apps Script 한계)');
  ok(!r1.pend, '전송 대기 표시 없음');
  ok(grew(rows1, base.coloring) === 1, '시트에 설문 1건 저장 (늘어난 행 ' + grew(rows1, base.coloring) + ')');

  console.log('\n═══ 2. 전송 도중 캐시가 증발해도 살아남는가 (오늘 사고 재현) ═══');
  /* 첫 조각이 서버에 닿은 직후 캐시를 통째로 날린다.
     예전 코드는 조각을 캐시에 모았으므로 여기서 설문 1건이 통째로 사라졌다. */
  /* 한 번만 날리면 프런트가 새 sid 로 재전송해 가려진다. 매 요청마다 날려
     '캐시가 전혀 못 믿을 상태' 를 만든다. 옛 코드는 여기서 반드시 0건이 된다. */
  let wiped = 0;
  await page.route('**/exec?*', async route => {
    const u = route.request().url();
    await route.continue();
    if (u.includes('action=survey')) {
      wiped++;
      await fetch(BASE + '/_cachewipe').catch(() => {});
    }
  });
  lens.length = 0;
  const r2 = await fillSurvey(page, 'coloring', { slot: '컬러링 14:00', name: '조각테스트B', long: true });
  const rows2 = await dump(page, '설문_컬러링체험');
  ok(wiped > 1, '매 조각마다 캐시를 실제로 날림 (' + wiped + '회)');
  ok(!r2.pend, '캐시가 날아가도 전송 대기 표시 없음');
  ok(grew(rows2, base.coloring) === 2, '캐시가 다 날아가도 2건째 저장 (늘어난 행 ' + grew(rows2, base.coloring) + ')');
  await page.unroute('**/exec?*');

  console.log('\n═══ 3. 내용이 온전한가 ═══');
  const head = rows2[0] || [];
  const last = rows2[rows2.length - 1] || [];
  const joined = last.join(' ');
  ok(joined.includes('조각테스트B'), '이름이 그대로 저장됨');
  ok(/가{280}/.test(joined), '280자 주관식이 잘리지 않음');
  const iMiss = head.indexOf('미응답 문항수');
  ok(iMiss < 0 || String(last[iMiss] || '0') === '0', '미응답 0건');

  console.log('\n═══ 4. 다 쓴 조각이 정리되는가 ═══');
  const chunks = await dump(page, '_설문조각');
  ok(!chunks || chunks.length <= 1, '조각 임시 탭이 비어 있음 (헤더만 ' + (chunks ? chunks.length : 0) + '행)');

  console.log('\n═══ 5. SNS · 스티커 설문도 그대로 ═══');
  await fillSurvey(page, 'sns', { name: 'SNS테스트' });
  await fillSurvey(page, 'sticker', { name: '스티커테스트' });
  const rs = await dump(page, '설문_SNS후기'), rk = await dump(page, '설문_스티커구매');
  ok(grew(rs, base.sns) === 1, 'SNS 후기 1건 저장 (늘어난 행 ' + grew(rs, base.sns) + ')');
  ok(grew(rk, base.sticker) === 1, '스티커 구매 설문 1건 저장 (늘어난 행 ' + grew(rk, base.sticker) + ')');

  await browser.close();
  console.log(process.exitCode ? '\n실패 있음\n' : '\n전부 통과\n');
})();
