/* 설문이 아직 제대로 저장되지 않으므로 손님 화면에서는 감춰 둔다.
   기본 주소로 들어오면 안 보이고, ?test=1 또는 ?k=0919 로 들어오면 보인다. */
const { chromium } = require('playwright');
const BASE = process.env.HM_BASE || 'http://127.0.0.1:8790';
const ok = (c,m) => { console.log((c?'  ✅':'  ❌')+' '+m); if(!c) process.exitCode = 1; };

(async () => {
  const br = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await br.newContext({viewport:{width:390,height:844}});

  for (const page of ['index.html', 'index_en.html']) {
    console.log('\n═══ ' + page + ' ═══');
    const p = await ctx.newPage();

    await p.goto(BASE + '/' + page, {waitUntil:'networkidle'});
    await p.waitForTimeout(600);
    ok(!(await p.locator('.survey-box').isVisible()), '손님 화면: 설문 영역 안 보임');
    ok(!(await p.locator('.sns-box').isVisible()),    '손님 화면: SNS 후기 영역 안 보임');
    ok(await p.locator('.reserve-slot-section').isVisible(), '예약 영역은 그대로 보임');

    await p.goto(BASE + '/' + page + '?test=1', {waitUntil:'networkidle'});
    await p.waitForTimeout(600);
    ok(await p.locator('.survey-box').isVisible(), '테스트 주소: 설문 영역 보임');
    ok(await p.locator('.testonly-note').first().isVisible(), '테스트 전용 안내 문구 표시');
    const href = await p.locator('#surveyBtn').getAttribute('href');
    ok(/test=1/.test(href), '설문 링크에 test=1 이 넘어감: ' + href);

    await p.goto(BASE + '/' + page + '?k=0919', {waitUntil:'networkidle'});
    await p.waitForTimeout(600);
    ok(await p.locator('.survey-box').isVisible(), '운영자 키(k=0919)로도 보임');

    await p.close();
  }
  await br.close();
  console.log(process.exitCode ? '\n실패 있음\n' : '\n전부 통과\n');
})();
