/* 2026-09-19 현장에서 설문이 한 건도 시트에 남지 않았다.
   화면은 전부 '제출되었습니다' 였다. 그래서 여기서는 화면을 믿지 않고
   시트에 실제로 남은 줄만 센다.

   지금 방식은 답변을 자르지 않는다. 문항을 덩이로 나눠 각 덩이를 그 자체로
   완결된 설문 1건으로 보낸다. 그러므로 확인할 것은 세 가지다.
     - 어떤 요청도 Apps Script 의 주소 길이 한계(약 2,000자)를 넘지 않는가
     - 캐시가 통째로 날아가도 답변이 하나도 빠짐없이 시트에 남는가
     - 증정 코드가 딱 한 줄에만 붙는가 (증정품 이중 지급 방지) */
const { chromium } = require('playwright');
const BASE = process.env.HM_BASE || 'http://127.0.0.1:8790';
const ok = (c, m) => { console.log((c ? '  ✅' : '  ❌') + ' ' + m); if (!c) process.exitCode = 1; };

const dump = async (page, tab) =>
  page.evaluate(u => fetch(u).then(r => r.json()).catch(() => null),
                BASE + '/_dump?tab=' + encodeURIComponent(tab));

/* 둘째 줄부터는 이름 뒤에 '(이어짐 2/3)' 이 붙는다. 합칠 때 떼고 본다. */
const bare = v => String(v).replace(/\s*\(이어짐\s*\d+(\/\d+)?\)\s*$/, '').trim();

/* 답이 길어 두 칸에 나눠 담긴 경우 '문항' + '문항 (이어 2)' … 를 순서대로 이어붙인다 */
function joinValues(o){
  const out = {};
  Object.keys(o).forEach(k => {
    const m = k.match(/^(.*?)\s*\(이어 (\d+)\)$/);
    const base = m ? m[1] : k, seq = m ? Number(m[2]) : 1;
    (out[base] = out[base] || [])[seq - 1] = o[k];
  });
  Object.keys(out).forEach(k => { out[k] = out[k].join(''); });
  return out;
}
/** 한 사람의 여러 줄을 이름으로 합쳐 {문항:답} 하나로 만든다 */
function mergeRows(rows, name) {
  const head = rows[0], iName = head.indexOf('이름'), out = {};
  rows.slice(1).forEach(r => {
    if (bare(r[iName]) !== name) return;
    head.forEach((h, i) => { if (String(r[i]).trim() !== '') out[h] = r[i]; });
  });
  const j = joinValues(out);
  j['이름'] = name;
  return j;
}
const linesOf = (rows, name) => {
  const i = rows[0].indexOf('이름');
  return rows.slice(1).filter(r => bare(r[i]) === name).length;
};

/** 설문 한 건을 끝까지 채워 제출한다. long = 주관식 글자 수 */
async function fillSurvey(page, type, opts = {}) {
  await page.goto(BASE + '/survey.html?t=' + type +
    (opts.slot ? '&slot=' + encodeURIComponent(opts.slot) : '') +
    (opts.name ? '&name=' + encodeURIComponent(opts.name) : ''), { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const answered = {};
  let guard = 0;
  while (guard++ < 20) {
    if (await page.locator('.done').count()) break;
    for (const c of await page.locator('.q').all()) {
      const scales = await c.locator('.scale').all();
      if (scales.length) { for (const sc of scales) await sc.locator('button').first().click(); continue; }
      const o = await c.locator('.opt').all();
      if (o.length) { if (!(await c.locator('.opt.on').count())) await o[0].click(); continue; }
      const ta = c.locator('textarea');
      if (await ta.count()) await ta.fill('좋'.repeat(opts.long || 12));
      /* 이름·링크 칸을 값으로 덮어쓰면 시트에서 사람을 못 찾는다. 칸 이름을 보고 채운다. */
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
  await page.waitForSelector('.done', { timeout: 25000 });
  /* 화면이 지워지기 전에 실제로 무엇을 답했는지 받아둔다 — 시트와 대조할 정답지 */
  const sent = await page.evaluate(() => JSON.parse(JSON.stringify(A)));   // A 는 최상위 let 이라 window 에 안 붙는다
  return { pend: (await page.locator('.pend').count()) > 0, sent, answered };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  const lens = [];
  page.on('request', r => { if (r.url().includes('action=survey')) lens.push(r.url().length); });

  await page.goto(BASE + '/survey.html', { waitUntil: 'domcontentloaded' });

  console.log('\n═══ 1. 컬러링 설문 — 답변이 빠짐없이 시트에 남는가 ═══');
  const r1 = await fillSurvey(page, 'coloring', { slot: '컬러링 13:30', name: '한통테스트A' });
  const rows1 = await dump(page, '설문_컬러링체험');
  ok(!r1.pend, '전송 대기 표시 없음');
  ok(Math.max(...lens) < 1800, '가장 긴 요청 주소 ' + Math.max(...lens) + '자 (나눠 보냄)');
  const m1 = mergeRows(rows1, '한통테스트A');
  const missing1 = Object.keys(r1.sent).filter(k => k !== '이름' && String(m1[k] || '') === '');
  ok(missing1.length === 0, '답한 ' + Object.keys(r1.sent).length + '문항이 모두 시트에 있음' +
     (missing1.length ? ' — 빠진 문항: ' + missing1.slice(0, 3).join(', ') : ''));
  console.log('    시트 줄 수: ' + linesOf(rows1, '한통테스트A') + '줄 (요청 ' + lens.length + '건)');

  console.log('\n═══ 2. 캐시가 통째로 날아가도 남는가 (오늘 사고 재현) ═══');
  let wiped = 0;
  await page.route('**/exec?*', async route => {
    const u = route.request().url();
    await route.continue();
    if (u.includes('action=survey')) { wiped++; await fetch(BASE + '/_cachewipe').catch(() => {}); }
  });
  lens.length = 0;
  const r2 = await fillSurvey(page, 'coloring', { slot: '컬러링 14:00', name: '한통테스트B', long: 120 });
  const rows2 = await dump(page, '설문_컬러링체험');
  await page.unroute('**/exec?*');
  ok(wiped > 1, '매 요청마다 캐시를 실제로 날림 (' + wiped + '회)');
  ok(!r2.pend, '캐시가 날아가도 전송 대기 표시 없음');
  ok(Math.max(...lens) < 1800, '긴 주관식에도 가장 긴 요청 ' + Math.max(...lens) + '자');
  const m2 = mergeRows(rows2, '한통테스트B');
  const missing2 = Object.keys(r2.sent).filter(k => k !== '이름' && String(m2[k] || '') === '');
  ok(missing2.length === 0, '주관식 120자짜리도 ' + Object.keys(r2.sent).length + '문항 모두 저장' +
     (missing2.length ? ' — 빠진 문항: ' + missing2.slice(0, 3).join(', ') : ''));
  const long = Object.keys(m2).filter(k => /^좋+$/.test(String(m2[k])) && String(m2[k]).length === 120);
  ok(long.length > 0, '120자 주관식이 잘리지 않고 그대로 (' + long.length + '문항)');

  console.log('\n═══ 3. 증정 코드는 딱 한 줄에만 (이중 지급 방지) ═══');
  const rk0 = await dump(page, '설문_스티커구매');
  const before = rk0 ? rk0.length : 0;
  const r3 = await fillSurvey(page, 'sticker', { name: '한통테스트C', long: 100 });
  const rk = await dump(page, '설문_스티커구매');
  const iCode = rk[0].indexOf('증정코드'), iName = rk[0].indexOf('이름');
  /* 이어짐 줄에도 서버가 코드를 뽑아 붙이지만, 고객 화면에 뜨는 코드는 첫 줄 것 하나뿐이다.
     증정 담당자가 볼 때 헷갈리지 않도록 이어짐 줄은 이름으로 구분된다. */
  const codes = rk.slice(1).filter(r => String(r[iName]).trim() === '한통테스트C' && String(r[iCode]).trim() !== '');
  const contin = rk.slice(1).filter(r => /\(이어짐 /.test(String(r[iName])) && bare(r[iName]) === '한통테스트C');
  ok(!r3.pend, '전송 완료');
  ok(codes.length === 1, '본 이름으로 증정 코드가 붙은 줄이 정확히 1개 (현재 ' + codes.length + '개)');
  ok(contin.every(r => /\(이어짐\s*\d+(\/\d+)?\)$/.test(String(r[iName]).trim())),
     '나머지 줄은 이름에 이어짐 표시 (' + contin.length + '줄) — 증정 담당자가 구분 가능');
  ok(/^HM-[A-Z0-9]{4}$/.test(String(codes[0] && codes[0][iCode]).trim()), '코드 형식 정상: ' + (codes[0] ? codes[0][iCode] : ''));
  const m3 = mergeRows(rk, '한통테스트C');
  const missing3 = Object.keys(r3.sent).filter(k => k !== '이름' && String(m3[k] || '') === '');
  ok(missing3.length === 0, '구매 설문도 ' + Object.keys(r3.sent).length + '문항 모두 저장');

  console.log('\n═══ 4. 여러 줄을 이름으로 다시 합칠 수 있는가 ═══');
  const iSplit = rows2[0].indexOf('분할');
  const iNm = rows2[0].indexOf('이름');
  const marks = rows2.slice(1).filter(r => bare(r[iNm]) === '한통테스트B')
                     .map(r => String(iSplit >= 0 ? r[iSplit] : '')).filter(Boolean);
  /* 둘째 줄부터 '이어짐 2', '이어짐 3' … 으로 번호가 이어져야 순서대로 합칠 수 있다 */
  const want = marks.map((_, i) => '이어짐 ' + (i + 2)).join(',');
  ok(marks.join(',') === want, '이어짐 번호가 순서대로: ' + (marks.join(' ') || '(한 줄이라 표시 없음)'));
  const firstRow = rows2.slice(1).find(r => String(r[iNm]).trim() === '한통테스트B');
  ok(!!firstRow && String(firstRow[iSplit] || '') === '', '첫 줄에는 이어짐 표시가 없음 (본 줄)');

  console.log('\n═══ 5. SNS 후기 ═══');
  const r5 = await fillSurvey(page, 'sns', { name: '한통테스트D' });
  const rs = await dump(page, '설문_SNS후기');
  ok(!r5.pend, 'SNS 후기 전송 완료');
  const m5 = mergeRows(rs, '한통테스트D');
  const miss5 = Object.keys(r5.sent).filter(k => k !== '이름' && String(m5[k] || '') === '');
  ok(miss5.length === 0, 'SNS 후기도 ' + Object.keys(r5.sent).length + '문항 모두 저장' +
     (miss5.length ? ' — 빠진 문항: ' + miss5.join(' / ') : ''));

  await browser.close();
  console.log(process.exitCode ? '\n실패 있음\n' : '\n전부 통과\n');
})();
