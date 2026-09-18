/* demoSeed() → 두 접수대 화면 확인 → 증정까지 → demoClear() 로 흔적 없이 지워지는지 */
const { chromium } = require('playwright');
const http = require('http');
const BASE = process.env.BASE || 'http://127.0.0.1:8815';
const KEY = '0919';
const errs = [];
const ok = (c, m) => { console.log((c ? '  ✅' : '  ❌') + ' ' + m); if (!c) process.exitCode = 1; };
const get = p => new Promise((res, rej) =>
  http.get(BASE + p, r => { let b=''; r.on('data',d=>b+=d); r.on('end',()=>res(b)); }).on('error', rej));
const run  = fn => get('/_run?fn=' + fn).then(t => { try { return JSON.parse(t); } catch (e) { throw new Error(t.slice(0,300)); } });
const dump = tab => get('/_dump?tab=' + encodeURIComponent(tab)).then(t => JSON.parse(t));

function hook(p, tag) {
  p.on('pageerror', e => errs.push('[' + tag + '] ' + e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    const u = ((m.location() || {}).url) || '';
    if (/fonts\.|favicon/.test(u + m.text())) return;
    if (/ERR_CERT_AUTHORITY_INVALID/.test(m.text()) && !u.includes('127.0.0.1')) return;
    errs.push('[' + tag + '] console: ' + m.text().slice(0, 120));
  });
}
const stockOf = async key => {
  const rows = await dump('재고');
  const h = rows[0], r = rows.slice(1).find(x => x[0] === key);
  return r ? Number(r[h.indexOf('잔여')]) : null;
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  console.log('\n═══ 0. 넣기 전 상태 ═══');
  const before = { 액자: await stockOf('액자'), 스티커: await stockOf('스티커'),
                   소서노: await stockOf('01 소서노'), 갯벌: await stockOf('03 갯벌') };
  console.log('   재고 — 액자 ' + before.액자 + ' · 스티커 ' + before.스티커 +
              ' · 소서노 ' + before.소서노 + ' · 갯벌 ' + before.갯벌);

  console.log('\n═══ 1. demoSeed() ═══');
  const seed = await run('demoSeed');
  ok(seed.ok === true, 'demoSeed 실행됨 — ' + seed.slot1 + ' / ' + seed.slot2);
  console.log('   ' + seed.names.join(' · '));
  ok(await stockOf('01 소서노') === before.소서노 - 1, '체험 중 1명 도안 차감 (소서노)');
  ok(await stockOf('03 갯벌')   === before.갯벌   - 1, '후기 1명 도안 차감 (갯벌)');

  console.log('\n═══ 2. 컬러링 접수대 ═══');
  const cp = await ctx.newPage(); hook(cp, 'coloring');
  await cp.goto(BASE + '/coloring.html?k=' + KEY + '&staff=' + encodeURIComponent('컬러링담당'), { waitUntil: 'networkidle' });
  await cp.locator('#slotSel').selectOption(seed.slot1);
  await cp.waitForTimeout(2000);

  const wait = cp.locator('.p', { hasText: '김대기' }).first();
  const exp  = cp.locator('.p', { hasText: '이체험' }).first();
  const rev  = cp.locator('.p', { hasText: '박후기' }).first();
  ok(await wait.count() === 1 && await exp.count() === 1 && await rev.count() === 1, '세 명이 모두 명단에 뜬다');
  ok((await wait.locator('.tel').textContent()).trim() === '9871', '김대기 뒷번호 9871');
  ok((await wait.locator('.acts .go').textContent()).includes('체험 시작'), '김대기 — 체험 시작 (대기 상태)');
  ok(await wait.locator('.designs').count() === 0, '대기 상태에는 도안이 안 뜬다');

  ok((await exp.getAttribute('class')).includes('att'), '이체험 — 체험 중');
  ok(await exp.locator('.rv.wait').count() === 1, '이체험 — "후기 작성 전"');
  ok(await exp.locator('button[data-give]').count() === 0, '이체험 — 작품 전달 버튼 없음');

  ok(await rev.locator('.rv.done').count() === 1, '박후기 — 후기 내용 표시');
  console.log('   후기: ' + (await rev.locator('.rv.done').textContent()).replace(/\s+/g,' ').trim().slice(0, 55) + '…');
  ok(await rev.locator('button[data-give]').count() === 1, '박후기 — 작품 전달 버튼 있음');
  await cp.screenshot({ path: '/tmp/demo_coloring.png', fullPage: true });

  // 담당자가 실제로 눌러본다
  await wait.locator('.acts .go').click();
  await cp.waitForTimeout(1600);
  ok((await cp.locator('.p', { hasText: '김대기' }).first().getAttribute('class')).includes('att'), '김대기 체험 시작 눌러보니 참석 처리');
  await cp.locator('.p', { hasText: '박후기' }).first().locator('button[data-give]').click();
  await cp.waitForTimeout(1600);
  ok((await cp.locator('.p', { hasText: '박후기' }).first().locator('button[data-give]').textContent()).includes('전달 완료'), '박후기 작품 전달 처리');
  await cp.close();

  console.log('\n═══ 3. 증정 접수대 ═══');
  const gp = await ctx.newPage(); hook(gp, 'gift');
  await gp.goto(BASE + '/gift.html?k=' + KEY + '&staff=' + encodeURIComponent('증정담당'), { waitUntil: 'networkidle' });
  await gp.waitForTimeout(2200);
  ok(await gp.locator('#nWait').textContent() === '2', '줄 차례 2건');
  const sns = gp.locator('.g', { hasText: '최에스' }).first();
  const buy = gp.locator('.g', { hasText: '정구매' }).first();
  ok((await sns.locator('.tel').textContent()).trim() === '1234', '최에스 뒷번호 1234');
  ok((await sns.locator('.item').textContent()).includes('액자'), '최에스 → 액자');
  ok(await sns.locator('.lk').count() === 1, '게시물 링크 있음');
  ok((await buy.locator('.tel').textContent()).trim() === '5678', '정구매 뒷번호 5678');
  ok((await buy.locator('.item').textContent()).includes('스티커'), '정구매 → 데코 스티커');
  await gp.screenshot({ path: '/tmp/demo_gift.png', fullPage: true });

  await sns.locator('button[data-give]').click();
  await gp.waitForTimeout(2000);
  ok(await stockOf('액자') === before.액자 - 1, '액자 전달 → 재고 1 차감');
  await gp.locator('.g', { hasText: '정구매' }).first().locator('button[data-give]').click();
  await gp.waitForTimeout(2000);
  ok(await stockOf('스티커') === before.스티커 - 1, '스티커 전달 → 재고 1 차감');
  ok(await gp.locator('#nWait').textContent() === '0', '줄 차례 0건');
  await gp.close();

  console.log('\n═══ 4. demoClear() — 흔적 없이 지워지나 ═══');
  const cl = await run('demoClear');
  ok(cl.ok === true, 'demoClear 실행됨');
  console.log('   지움: 예약 ' + cl.removed.예약 + ' · 체크인 ' + cl.removed.체크인 +
              ' · 설문 ' + cl.removed.설문 + ' · 판매 ' + cl.removed.판매);
  console.log('   되돌린 재고: ' + (cl.restored.join(', ') || '없음'));

  const after = { 액자: await stockOf('액자'), 스티커: await stockOf('스티커'),
                  소서노: await stockOf('01 소서노'), 갯벌: await stockOf('03 갯벌') };
  ok(after.액자   === before.액자,   '액자 재고 원복 ('   + before.액자   + ' → ' + after.액자 + ')');
  ok(after.스티커 === before.스티커, '스티커 재고 원복 (' + before.스티커 + ' → ' + after.스티커 + ')');
  ok(after.소서노 === before.소서노, '소서노 재고 원복 (' + before.소서노 + ' → ' + after.소서노 + ')');
  ok(after.갯벌   === before.갯벌,   '갯벌 재고 원복 ('   + before.갯벌   + ' → ' + after.갯벌 + ')');

  for (const tab of ['설문지 응답 시트1', '체크인', '판매', '설문_컬러링체험', '설문_SNS후기', '설문_스티커구매']) {
    const rows = await dump(tab);
    const left = (rows || []).slice(1).filter(r => r.some(v => String(v).indexOf('[테스트]') !== -1));
    ok(left.length === 0, tab + ' 탭에 더미 흔적 없음' + (left.length ? ' — ' + JSON.stringify(left[0]) : ''));
  }

  console.log('\n═══ 결과 ═══');
  if (errs.length) { console.log('  스크립트 오류 ' + errs.length + '건:'); errs.forEach(e => console.log('   ✗ ' + e)); process.exitCode = 1; }
  else console.log('  스크립트 오류 없음');
  await b.close();
})();
