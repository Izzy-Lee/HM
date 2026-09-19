/* 컬러링 접수대(coloring.html) · 증정 접수대(gift.html) 실제 동작 확인 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8810';
const KEY = '0919';
const errs = [];
const ok = (c, m) => { console.log((c ? '  ✅' : '  ❌') + ' ' + m); if (!c) process.exitCode = 1; };

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

/* 설문 하나를 끝까지 채워 제출 */
async function survey(ctx, type, name, slot, shot) {
  const p = await ctx.newPage(); hook(p, 'survey');
  await p.goto(BASE + '/survey.html?t=' + type + '&name=' + encodeURIComponent(name) +
               (slot ? '&slot=' + encodeURIComponent(slot) : ''), { waitUntil: 'networkidle' });
  let guard = 0;
  while (guard++ < 25) {
    if (await p.locator('.done').count()) break;
    for (const q of await p.locator('.q').all()) {
      const sc = await q.locator('.scale').all();
      if (sc.length) { for (const s of sc) await s.locator('button').nth(3).click(); continue; }
      const ph = q.locator('#photoInput');
      if (await ph.count()) { await ph.setInputFiles(shot); await p.waitForTimeout(1200); continue; }
      const opts = await q.locator('.opt').all();
      if (opts.length) { if (!(await q.locator('.opt.on').count())) await opts[0].click(); continue; }
      const ta = q.locator('textarea');
      if (await ta.count()) await ta.fill('아이가 정말 좋아했어요 색이 예뻐요');
      const sh = q.locator('input[data-t]');
      if (await sh.count()) {
        const lab = (await q.textContent()) || '';
        await sh.fill(lab.includes('링크') ? 'https://instagram.com/p/abc123'
                    : lab.includes('이름') ? name : '15,000원');
      }
    }
    await p.locator('#bNext').click();
    await p.waitForTimeout(500);
  }
  const done = await p.locator('.done').count() > 0;
  const code = await p.locator('.code .cv').count() ? (await p.locator('.code .cv').textContent()).trim() : '';
  await p.close();
  return { done, code };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  const SHOT = path.join(__dirname, '_desk_shot.jpg');
  { const t = await b.newPage();
    const u = await t.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 700;
      const x = c.getContext('2d'); x.fillStyle = '#8a3d6b'; x.fillRect(0,0,900,700);
      return c.toDataURL('image/jpeg', 0.9); });
    fs.writeFileSync(SHOT, Buffer.from(u.split(',')[1], 'base64')); await t.close(); }

  /* ── 준비: 14:00 회차에 두 명 예약 ── */
  console.log('\n═══ 0. 준비 — 14:00 회차 예약 2명 ═══');
  for (const c of [{n:'김손님', t:'010-1234-9871'}, {n:'이손님', t:'010-5555-4432'}]) {
    const p = await ctx.newPage(); hook(p, 'book');
    await p.goto(BASE + '/reserve.html?program=' + encodeURIComponent('컬러링') + '&time=14:00', { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    const on = async sel => { const e = p.locator(sel);
      if (!/\bon\b/.test((await e.getAttribute('class')) || '')) { await e.click(); await p.waitForTimeout(150); } };
    await on('[data-prog="컬러링"]'); await on('[data-time="14:00"]');
    await p.locator('#fName').fill(c.n); await p.locator('#fTel').fill(c.t);
    await p.locator('#submit').click(); await p.waitForTimeout(1500);
    ok(await p.locator('.done').count() === 1, c.n + ' 예약 완료');
    await p.close();
  }

  /* ── 1. 컬러링 접수대 ── */
  console.log('\n═══ 1. 컬러링 접수대 ═══');
  const cp = await ctx.newPage(); hook(cp, 'coloring');
  await cp.goto(BASE + '/coloring.html', { waitUntil: 'networkidle' });
  ok(await cp.locator('#gate').isVisible(), '키 없이 열면 접근키 화면');
  ok(!(await cp.locator('#app').isVisible()), '키 없이 열면 명단 숨김');

  await cp.goto(BASE + '/coloring.html?k=' + KEY + '&staff=' + encodeURIComponent('컬러링담당'), { waitUntil: 'networkidle' });
  await cp.locator('#slotSel').selectOption('컬러링 14:00');
  await cp.waitForTimeout(1800);

  const card = cp.locator('.p[data-name="김손님"]');
  ok(await card.count() === 1, '14:00 명단에 김손님이 뜬다');
  ok((await card.locator('.tel').textContent()).trim() === '9871',
     '휴대폰 뒷 4자리 표시: ' + (await card.locator('.tel').textContent()).trim());
  ok((await card.locator('.acts .go').textContent()).includes('체험 시작'), '체험 시작 버튼');

  await card.locator('.acts .go').click();
  await cp.waitForTimeout(1600);
  const card2 = cp.locator('.p[data-name="김손님"]');
  ok((await card2.getAttribute('class')).includes('att'), '누르면 바로 체험 중으로 바뀜');
  ok(await card2.locator('.designs button').count() === 4, '체험 중이면 도안 4종 노출');
  ok((await card2.locator('.rv.wait').textContent()).includes('후기 작성 전'), '후기 전에는 "후기 작성 전"');
  ok(await card2.locator('button[data-give]').count() === 0, '후기 전에는 작품 전달 버튼이 안 뜬다');

  await card2.locator('button[data-design="03 갯벌"]').click();
  await cp.waitForTimeout(1500);
  ok((await cp.locator('.p[data-name="김손님"] button[data-design="03 갯벌"]').getAttribute('class')).includes('on'), '도안 선택 반영');
  ok((await cp.locator('#cAtt').textContent()) === '1', '체험 중 1명으로 집계');

  /* 손님이 후기 작성 */
  console.log('\n═══ 2. 손님이 컬러링 후기 작성 ═══');
  const sv = await survey(ctx, 'coloring', '김손님', '컬러링 14:00', SHOT);
  ok(sv.done, '컬러링 설문 제출됨');

  await cp.locator('#reload').click();
  await cp.waitForTimeout(1800);
  const card3 = cp.locator('.p[data-name="김손님"]');
  ok(await card3.locator('.rv.done').count() === 1, '후기가 담당자 화면에 표시됨');
  console.log('    후기:', (await card3.locator('.rv.done').textContent()).replace(/\s+/g, ' ').trim().slice(0, 60));
  const give = card3.locator('button[data-give]');
  ok(await give.count() === 1, '후기가 오면 작품 전달 버튼이 생김');
  await give.click();
  await cp.waitForTimeout(1600);
  ok((await cp.locator('.p[data-name="김손님"] button[data-give]').textContent()).includes('전달 완료'), '작품 전달 처리됨');
  ok((await cp.locator('#cGive').textContent()) === '1', '작품 전달 1건 집계');

  /* 현장 접수 */
  await cp.locator('#walkIn').fill('현장손님');
  await cp.locator('#walkBtn').click();
  await cp.waitForTimeout(1800);
  ok(await cp.locator('.p[data-name="현장손님"]').count() === 1, '현장 접수로 명단 추가');
  await cp.close();

  /* ── 3. 증정 접수대 ── */
  console.log('\n═══ 3. 증정 접수대 ═══');
  const sns = await survey(ctx, 'sns', '이손님', '컬러링 14:00', SHOT);
  ok(sns.done, 'SNS 후기 제출됨 (코드 ' + sns.code + ')');
  const buy = await survey(ctx, 'sticker', '박구매', '', SHOT);
  ok(buy.done, '스티커 구매 후기 제출됨 (코드 ' + buy.code + ')');

  const gp = await ctx.newPage(); hook(gp, 'gift');
  await gp.goto(BASE + '/gift.html', { waitUntil: 'networkidle' });
  ok(await gp.locator('#gate').isVisible(), '키 없이 열면 접근키 화면');

  await gp.goto(BASE + '/gift.html?k=' + KEY + '&staff=' + encodeURIComponent('증정담당'), { waitUntil: 'networkidle' });
  await gp.waitForTimeout(2000);
  ok(await gp.locator('.g').count() === 2, '줄 차례 2건 (SNS 1 · 구매 1) — 실제 ' + await gp.locator('.g').count());

  const snsCard = gp.locator('.g', { hasText: '이손님' }).first();
  ok((await snsCard.locator('.tel').textContent()).trim() === '4432',
     'SNS 후기에 휴대폰 뒷자리 표시: ' + (await snsCard.locator('.tel').textContent()).trim());
  ok((await snsCard.locator('.item').textContent()).includes('액자'), 'SNS 후기 → 액자');
  ok(await snsCard.locator('.lk').count() === 1, '게시물 링크 열기 버튼');

  const buyCard = gp.locator('.g', { hasText: '박구매' }).first();
  ok((await buyCard.locator('.item').textContent()).includes('스티커'), '구매 후기 → 데코 스티커');

  const frameBefore = Number(await gp.locator('#nFrame').textContent());
  await snsCard.locator('button[data-give]').click();
  await gp.waitForTimeout(2000);
  ok(Number(await gp.locator('#nFrame').textContent()) === frameBefore - 1,
     '액자 전달 시 재고 1 차감 (' + frameBefore + ' → ' + await gp.locator('#nFrame').textContent() + ')');
  ok(await gp.locator('#nWait').textContent() === '1', '줄 차례가 1건으로 줄어듦');
  ok(await gp.locator('#nDone').textContent() === '1', '전달 완료 1건');

  /* 중복 지급 차단 */
  await gp.locator('.tabs button[data-p="done"]').click();
  await gp.waitForTimeout(400);
  const doneBtn = gp.locator('.g button[data-give]').first();
  ok(await doneBtn.isDisabled(), '전달 완료 건은 버튼이 잠김 (중복 지급 차단)');

  /* 코드로 직접 증정 */
  await gp.locator('.tabs button[data-p="wait"]').click();
  await gp.waitForTimeout(400);
  const stickerBefore = Number(await gp.locator('#nSticker').textContent());
  await gp.locator('#codeIn').fill(buy.code);
  await gp.locator('#codeGo').click();
  await gp.waitForTimeout(2200);
  ok(Number(await gp.locator('#nSticker').textContent()) === stickerBefore - 1,
     '코드 입력으로도 증정됨, 스티커 1 차감 (' + stickerBefore + ' → ' + await gp.locator('#nSticker').textContent() + ')');
  ok(await gp.locator('#nWait').textContent() === '0', '줄 차례 0건');
  await gp.close();

  /* ── 4. 판매 시트에 증정이 남았나 ── */
  console.log('\n═══ 4. 기록 확인 ═══');
  const chk = await ctx.newPage();
  await chk.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  const sales = await chk.evaluate(async () => (await fetch('/_dump?tab=' + encodeURIComponent('판매'))).json());
  const gifts = sales.slice(1).filter(r => String(r[5]) === '설문증정');
  ok(gifts.length === 2, '판매 시트에 증정 2건 기록 (' + gifts.length + ')');
  ok(gifts.every(r => Number(r[4]) === 0), '증정은 매출 0원');
  console.log('    ' + gifts.map(r => r[1] + ' / ' + r[6] + ' / ' + r[7]).join('  |  '));
  await chk.close();

  fs.unlinkSync(SHOT);
  console.log('\n═══ 결과 ═══');
  if (errs.length) { console.log('  스크립트 오류 ' + errs.length + '건:'); errs.forEach(e => console.log('   ✗ ' + e)); process.exitCode = 1; }
  else console.log('  스크립트 오류 없음');
  await b.close();
})();
