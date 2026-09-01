const { chromium } = require('playwright');
const BASE='http://127.0.0.1:8790', KEY='michu919';
const ok=(c,m)=>console.log((c?'  ✅':'  ❌')+' '+m);

(async()=>{
  const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await browser.newContext({viewport:{width:390,height:844}});
  const page = await ctx.newPage();
  page.on('pageerror',e=>console.log('  ✗ PAGE ERROR: '+e.message));

  await page.goto(BASE+'/staff.html?k='+KEY,{waitUntil:'networkidle'});
  await page.waitForTimeout(800);
  const rev0 = await page.locator('#rev').textContent();
  console.log('\n═══ 오프라인 큐 (부스에서 네트워크 끊기는 상황) ═══');
  console.log('  시작 매출:', rev0);

  // /exec 쓰기 요청만 죽인다 — 네트워크 장애 흉내
  await page.route('**/exec**', r => {
    const u = r.request().url();
    if (u.includes('action=sale') || u.includes('action=memo') || u.includes('action=checkin')) return r.abort('failed');
    return r.continue();
  });

  // 끊긴 상태에서 판매 3건
  for (const [item,pay] of [['바인더 완성품','현금'],['스티커','카드'],['바인더 체험','계좌']]) {
    await page.locator('.prod-main[data-item="'+item+'"]').click();
    await page.waitForTimeout(200);
    await page.locator('.pays button[data-pay="'+pay+'"]').click();
    await page.waitForTimeout(700);
  }
  const banner = await page.locator('#queue').textContent();
  const visible = await page.locator('#queue').isVisible();
  ok(visible && /3건/.test(banner), '전송 실패 3건이 큐에 쌓이고 배너 표시: "'+banner.trim()+'"');

  const qLen = await page.evaluate(()=>JSON.parse(localStorage.getItem('hm_queue_v1')||'[]').length);
  ok(qLen===3, 'localStorage 에 3건 보존 (폰 꺼져도 남음)');

  // 관찰 태그도 큐로
  await page.locator('.tabs button[data-p="memo"]').click();
  await page.waitForTimeout(200);
  await page.locator('.tags button[data-tag="대기발생"]').click();
  await page.waitForTimeout(600);
  ok((await page.evaluate(()=>JSON.parse(localStorage.getItem('hm_queue_v1')||'[]').length))===4, '관찰 태그도 큐에 누적 (4건)');

  const revOffline = await page.locator('#rev').textContent();
  ok(revOffline===rev0, '오프라인 중에는 매출이 늘지 않음 (서버 미반영이라 정확)');

  // 새로고침해도 큐가 살아있는지 — 폰 잠금/재시작 상황
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(500);
  ok((await page.evaluate(()=>JSON.parse(localStorage.getItem('hm_queue_v1')||'[]').length))===4, '새로고침 후에도 큐 4건 유지');

  // 네트워크 복구
  console.log('\n  ── 네트워크 복구 ──');
  await page.unroute('**/exec**');
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(4000);

  const qAfter = await page.evaluate(()=>JSON.parse(localStorage.getItem('hm_queue_v1')||'[]').length);
  ok(qAfter===0, '복구 후 큐 자동 전송 완료 (남은 '+qAfter+'건)');
  const revAfter = await page.locator('#rev').textContent();
  console.log('  복구 후 매출:', revAfter);
  const expect = 30000+2000+20000;
  ok(revAfter.replace(/[^0-9]/g,'')===String(rev0.replace(/[^0-9]/g,'')*1+expect), '누락 없이 3건 모두 반영 (+'+expect.toLocaleString()+'원)');
  ok(!(await page.locator('#queue').isVisible()), '배너 사라짐');

  // 서버 기록 대조
  const rep = await page.evaluate(async()=>{ const r=await fetch('/exec?action=report'); return r.json(); });
  console.log('  서버 관찰메모 대기발생:', rep.tags['대기발생'], '건');
  ok(rep.tags['대기발생']>=1, '큐에 있던 관찰 태그도 서버에 도착');

  await browser.close();
})().catch(e=>{console.error('실패:',e);process.exit(1);});
