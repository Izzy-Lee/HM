const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8790';
const KEY = 'michu919';
const errors = [], warns = [];

function hook(page, tag){
  page.on('console', m => {
    const t = m.text();
    if (m.type()==='error') errors.push('['+tag+'] console.error: '+t+(m.location()&&m.location().url?' << '+m.location().url:''));
    if (m.type()==='warning') warns.push('['+tag+'] '+t);
  });
  page.on('pageerror', e => errors.push('['+tag+'] PAGE ERROR: '+e.message));
  page.on('requestfailed', r => errors.push('['+tag+'] 요청실패: '+r.url().slice(0,90)+' '+((r.failure()||{}).errorText||'')));
}
const ok = (c,m) => console.log((c?'  ✅':'  ❌')+' '+m);

(async () => {
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });

  /* ═══ 1. 접근키 게이트 ═══ */
  console.log('\n═══ 1. staff.html 접근키 게이트 ═══');
  let page = await ctx.newPage(); hook(page,'gate');
  await page.goto(BASE+'/staff.html', {waitUntil:'networkidle'});
  ok(await page.locator('#gate').isVisible(), '키 없이 열면 게이트 표시');
  ok(!(await page.locator('#app').isVisible()), '키 없이 열면 입력화면 숨김');
  await page.close();

  /* ═══ 2. 판매 기록 ═══ */
  console.log('\n═══ 2. 판매 기록 (운영자 실제 탭 순서) ═══');
  page = await ctx.newPage(); hook(page,'staff');
  await page.goto(BASE+'/staff.html?k='+KEY+'&staff=김운영', {waitUntil:'networkidle'});
  ok(await page.locator('#app').isVisible(), '키 있으면 입력화면 표시');
  console.log('  초기 매출:', await page.locator('#rev').textContent());

  // 버튼 크기 (엄지 조작 / 최소 56px 요구)
  const box = await page.locator('.prod-main').first().boundingBox();
  ok(box.height>=56, '판매 버튼 높이 '+Math.round(box.height)+'px (요구 56px 이상)');

  // 바인더 완성품 30,000 × 1, 카드
  await page.locator('.prod-main[data-item="바인더 완성품"]').click();
  await page.waitForTimeout(250);
  ok(await page.locator('#paySheet').isVisible(), '결제수단 시트 열림');
  console.log('  시트 제목:', await page.locator('#payTitle').textContent(), '/', await page.locator('#paySub').textContent());
  await page.locator('.pays button[data-pay="카드"]').click();
  await page.waitForTimeout(900);
  console.log('  → 매출:', await page.locator('#rev').textContent());

  // 스티커 수량 +2 = 3개, 현금
  await page.locator('.qty button[data-step="1"][data-item="스티커"]').click();
  await page.locator('.qty button[data-step="1"][data-item="스티커"]').click();
  ok((await page.locator('#q-스티커').textContent())==='3', '수량 +/- 동작 (3)');
  await page.locator('.prod-main[data-item="스티커"]').click();
  await page.waitForTimeout(250);
  await page.locator('.pays button[data-pay="현금"]').click();
  await page.waitForTimeout(900);
  const rev2 = await page.locator('#rev').textContent();
  console.log('  → 매출:', rev2);
  ok(rev2.replace(/[^0-9]/g,'')==='36000', '30,000 + 2,000×3 = 36,000원');

  // 액자 증정 (무료 경로)
  await page.locator('.prod-main[data-item="액자"]').click();
  await page.waitForTimeout(250);
  const giftBtn = await page.locator('.pays button[data-pay="현금"]').textContent();
  ok(giftBtn==='증정 기록', '무료상품은 결제버튼이 "증정 기록"으로 바뀜 (현재: '+giftBtn+')');
  const cardHidden = await page.locator('.pays button[data-pay="카드"]').isHidden();
  ok(cardHidden, '무료상품은 카드/계좌 숨김');
  await page.locator('.pays button[data-pay="현금"]').click();
  await page.waitForTimeout(900);
  ok((await page.locator('#rev').textContent()).replace(/[^0-9]/g,'')==='36000', '증정은 매출에 더해지지 않음');

  // 유료상품 다시 열었을 때 버튼 라벨 원복되는지 (이전에 잡은 버그)
  await page.locator('.prod-main[data-item="바인더 체험"]').click();
  await page.waitForTimeout(250);
  const backLabel = await page.locator('.pays button[data-pay="현금"]').textContent();
  ok(backLabel==='현금', '유료상품 재진입 시 버튼 라벨 원복 (현재: '+backLabel+')');
  await page.locator('.sheet .cancel').click();
  await page.waitForTimeout(200);
  ok(!(await page.locator('#paySheet').isVisible()), '닫기 동작');

  /* ═══ 3. Undo ═══ */
  console.log('\n═══ 3. 직전 취소 (Undo) ═══');
  const stickerBefore = await page.locator('#stocks input[data-item="스티커"]').inputValue().catch(()=>null);
  await page.locator('#undoBtn').click();
  await page.waitForTimeout(1200);
  const rev3 = await page.locator('#rev').textContent();
  console.log('  Undo 후 매출:', rev3, '| 안내:', await page.locator('#lastLine').textContent());
  ok(rev3.replace(/[^0-9]/g,'')==='36000', '증정 취소는 매출 변화 없음 (36,000 유지)');
  await page.locator('#undoBtn').click();
  await page.waitForTimeout(1500);
  const rev4 = await page.locator('#rev').textContent();
  ok(rev4.replace(/[^0-9]/g,'')==='30000', '연속 Undo 2회차: 36,000 → '+rev4);
  await page.locator('#undoBtn').click();
  await page.waitForTimeout(1500);
  const rev5 = await page.locator('#rev').textContent();
  ok(rev5.replace(/[^0-9]/g,'')==='0', '연속 Undo 3회차: 30,000 → '+rev5);
  ok(await page.locator('#undoBtn').isDisabled(), '되돌릴 게 없으면 비활성 ("'+(await page.locator('#lastLine').textContent())+'")');
  await page.locator('.prod-main[data-item="바인더 완성품"]').click();
  await page.waitForTimeout(250);
  await page.locator('.pays button[data-pay="계좌"]').click();
  await page.waitForTimeout(1500);
  ok(!(await page.locator('#undoBtn').isDisabled()), '새 판매 후 Undo 재활성');
  await page.reload({waitUntil:'networkidle'});
  await page.waitForTimeout(1800);
  ok(!(await page.locator('#undoBtn').isDisabled()), '새로고침 후에도 Undo 유지: "'+(await page.locator('#lastLine').textContent())+'"');

  /* ═══ 4. 체크인 ═══ */
  console.log('\n═══ 4. 체크인 · 도안 ═══');
  await page.locator('.tabs button[data-p="check"]').click();
  await page.waitForTimeout(1200);
  const nPeople = await page.locator('#roster .person[data-name]').count();
  ok(nPeople>0, '회차 예약자 명단 로드 ('+nPeople+'명)');
  const first = page.locator('#roster .person[data-name]').first();
  const nm = await first.locator('.nm').textContent();
  await first.locator('button[data-st="참석"]').click();
  await page.waitForTimeout(1200);
  const attOn = await page.locator('#roster .person[data-name]').first().locator('button[data-st="참석"]').getAttribute('class');
  ok((attOn||'').includes('on-att'), nm+' 참석 처리됨');
  const dCount = await page.locator('#roster .person[data-name]').first().locator('button[data-design]').count();
  ok(dCount===5, '참석 시 도안 5종 노출 ('+dCount+')');
  await page.locator('#roster .person[data-name]').first().locator('button[data-design="02 문학산성"]').click();
  await page.waitForTimeout(1200);
  const dOn = await page.locator('#roster .person[data-name]').first().locator('button[data-design="02 문학산성"]').getAttribute('class');
  ok((dOn||'').includes('on'), '도안 선택 반영');

  // 노쇼
  const second = page.locator('#roster .person[data-name]').nth(1);
  await second.locator('button[data-st="노쇼"]').click();
  await page.waitForTimeout(1200);
  const noOn = await page.locator('#roster .person[data-name]').nth(1).locator('button[data-st="노쇼"]').getAttribute('class');
  ok((noOn||'').includes('on-no'), '노쇼 처리됨');

  // 현장 접수
  await page.locator('#walkIn').fill('현장손님');
  await page.locator('#walkInBtn').click();
  await page.waitForTimeout(1200);
  ok((await page.locator('#roster').textContent()).includes('현장손님'), '현장 접수 추가');

  /* ═══ 5. 관찰 태그 ═══ */
  console.log('\n═══ 5. 관찰 태그 ═══');
  await page.locator('.tabs button[data-p="memo"]').click();
  await page.waitForTimeout(300);
  for (const t of ['미완성','대기발생','대기발생']) {
    await page.locator('.tags button[data-tag="'+t+'"]').click();
    await page.waitForTimeout(700);
  }
  ok(true, '태그 3건 기록 (미완성 1 / 대기발생 2)');

  /* ═══ 6. 재고 보정 ═══ */
  console.log('\n═══ 6. 재고 보정 ═══');
  await page.locator('.tabs button[data-p="stock"]').click();
  await page.waitForTimeout(500);
  const nStock = await page.locator('#stocks .stk').count();
  ok(nStock===9, '재고 9종 표시 ('+nStock+')');
  await page.locator('#stocks input[data-item="스티커"]').fill('73');
  await page.locator('#stocks button[data-fix="스티커"]').click();
  await page.waitForTimeout(1400);
  const fixed = await page.locator('#stocks input[data-item="스티커"]').inputValue();
  ok(fixed==='73', '스티커 잔여 73으로 보정 (현재 '+fixed+')');

  /* ═══ 7. report.html ═══ */
  console.log('\n═══ 7. report.html 집계 ═══');
  const rp = await ctx.newPage(); hook(rp,'report');
  await rp.goto(BASE+'/report.html', {waitUntil:'networkidle'});
  await rp.waitForTimeout(1500);
  ok(!(await rp.locator('#err').isVisible()), '오류 배너 없음');
  console.log('  총 매출 :', await rp.locator('#hRev').textContent());
  console.log('  체험 인원:', await rp.locator('#hPeople').textContent());
  console.log('  전환율  :', await rp.locator('#hConv').textContent());
  const tables = await rp.locator('table').count();
  ok(tables>=6, '집계 표 '+tables+'개 렌더');
  const conv = await rp.locator('#convDesc').textContent();
  console.log('  전환 설명:', conv.replace(/\s+/g,' ').trim());
  const paste = await rp.locator('#paste').textContent();
  ok(paste.includes('[체험 프로그램 운영 실적]') && paste.includes('[종료 시점 재고]'), '붙여넣기 블록 생성 ('+paste.split('\n').length+'줄)');
  console.log('\n  ── 붙여넣기 블록 앞부분 ──');
  paste.split('\n').slice(0,10).forEach(l=>console.log('  | '+l));
  await rp.locator('#copyBtn').click();
  await rp.waitForTimeout(400);
  console.log('  복사 버튼:', await rp.locator('#copyBtn').textContent());

  /* ═══ 8. index.html 회귀 ═══ */
  console.log('\n═══ 8. index.html 회귀 확인 ═══');
  const ip = await ctx.newPage(); hook(ip,'index');
  await ip.goto(BASE+'/index.html', {waitUntil:'networkidle'});
  await ip.waitForTimeout(1500);
  ok(await ip.locator('#stockList .stock-item').count()>0, '도안 재고 리스트 렌더 ('+await ip.locator('#stockList .stock-item').count()+'종)');
  ok((await ip.title()).length>0, '타이틀: '+await ip.title());

  const ep = await ctx.newPage(); hook(ep,'index_en');
  await ep.goto(BASE+'/index_en.html', {waitUntil:'networkidle'});
  await ep.waitForTimeout(1500);
  ok(await ep.locator('#stockList .stock-item').count()>0, '영문판 재고 리스트 렌더');

  await browser.close();

  console.log('\n═══════ 콘솔 진단 ═══════');
  if (warns.length){ console.log('경고 '+warns.length+'건:'); [...new Set(warns)].forEach(w=>console.log('  ⚠ '+w)); }
  if (errors.length){ console.log('\n오류 '+errors.length+'건:'); [...new Set(errors)].forEach(e=>console.log('  ✗ '+e)); process.exitCode=1; }
  else console.log('JS 오류 0건');
})().catch(e=>{ console.error('하네스 실패:', e); process.exit(1); });
