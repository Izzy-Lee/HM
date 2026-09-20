/* 설문이 실패하면 따로 주소를 열지 않아도 그 자리에서 원인이 찍혀야 한다.
   손님도, 운영자도 '사유' 한 줄만 보고 넘기면 되도록. */
const { chromium } = require('playwright');
const BASE = process.env.HM_BASE || 'http://127.0.0.1:8876';
const ok = (c,m) => { console.log((c?'  ✅':'  ❌')+' '+m); if(!c) process.exitCode = 1; };

async function fill(p){
  await p.goto(BASE + '/survey.html?t=sns&name=진단테스트', {waitUntil:'networkidle'});
  await p.waitForTimeout(300);
  let g = 0;
  while (g++ < 60){
    if (await p.locator('.done').count()) break;
    for (const c of await p.locator('.q').all()){
      const o = await c.locator('.opt').all();
      if (o.length){ if(!(await c.locator('.opt.on').count())) await o[0].click(); continue; }
      const ta = c.locator('textarea'); if (await ta.count()) await ta.fill('좋았어요');
      for (const sh of await c.locator('input[data-t]').all()){
        const t = (await sh.getAttribute('data-t')) || '';
        await sh.fill(t.includes('이름') ? '진단테스트' : (t.includes('링크') ? 'https://x.com/a' : '1,000원'));
      }
    }
    /* 제출 중에는 버튼이 잠긴다. 잠겨 있으면 누르지 말고 완료 화면을 기다린다. */
    if (await p.locator('#bNext').isDisabled()) { await p.waitForTimeout(1000); continue; }
    await p.locator('#bNext').click(); await p.waitForTimeout(500);
  }
  await p.waitForSelector('.done', {timeout:60000});
}

(async () => {
  const br = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const p = await (await br.newContext({viewport:{width:390,height:844}})).newPage();

  console.log('\n═══ 서버가 설문만 거부할 때 ═══');
  await p.goto(BASE + '/survey.html', {waitUntil:'domcontentloaded'});
  await p.evaluate(u => fetch(u), BASE + '/_block?on=1');
  await fill(p);

  await p.waitForSelector('.pend .why', {timeout:30000});
  const why = (await p.locator('.pend .why').textContent()).trim();
  console.log('\n  화면에 찍힌 사유:\n  ' + why.replace(/\s+/g, ' ') + '\n');

  ok(/전송 실패/.test(why), '무엇이 실패했는지 적힘');
  ok(/회차 조회: 정상/.test(why), '대조군(회차 조회)은 정상이라고 적힘');
  ok(/설문 최소 전송: HTTP 500/.test(why), '설문 요청의 실제 응답 코드가 적힘');
  ok(/unable to open the file/.test(why), '서버가 보낸 본문까지 적힘');
  ok(/화면 09\d\d-[a-z]/.test(why), '화면 판 번호가 적힘');

  console.log('\n═══ 서버가 멀쩡할 때는 진단이 안 뜬다 ═══');
  await p.evaluate(u => fetch(u), BASE + '/_block?on=0');
  await fill(p);
  ok((await p.locator('.pend').count()) === 0, '정상 전송이면 대기 배너 자체가 없음');

  await br.close();
  console.log(process.exitCode ? '\n실패 있음\n' : '\n전부 통과\n');
})();
