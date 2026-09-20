/* 설문은 POST 로 보낸다 — 주소 길이 한계도, 주소가 잘리는 일도 없다.
   서버에 doPost 가 없는 옛 배포에서는 예전 방식(JSONP)으로 알아서 내려가야 한다. */
const { chromium } = require('playwright');
const BASE = process.env.HM_BASE || 'http://127.0.0.1:8877';
const ok = (c,m) => { console.log((c?'  ✅':'  ❌')+' '+m); if(!c) process.exitCode = 1; };
/* 한 사람이 여러 줄로 남는다. 둘째 줄부터는 이름 뒤에 '(이어짐 2)' 가 붙으므로
   사람 수는 그 표시가 없는 줄만 센다. */
const people = r => {
  if (!r || r.length < 2) return 0;
  const i = r[0].indexOf('이름');
  return r.slice(1).filter(x => !/\(이어짐\s*\d+\)\s*$/.test(String(x[i]))).length;
};

async function fill(p, name){
  await p.goto(BASE + '/survey.html?t=sns&name=' + encodeURIComponent(name), {waitUntil:'networkidle'});
  await p.waitForTimeout(300);
  let g = 0;
  while (g++ < 40){
    if (await p.locator('.done').count()) break;
    for (const c of await p.locator('.q').all()){
      const o = await c.locator('.opt').all();
      if (o.length){ if(!(await c.locator('.opt.on').count())) await o[0].click(); continue; }
      const ta = c.locator('textarea'); if (await ta.count()) await ta.fill('좋았어요');
      for (const sh of await c.locator('input[data-t]').all()){
        const t = (await sh.getAttribute('data-t')) || '';
        await sh.fill(t.includes('이름') ? name : (t.includes('링크') ? 'https://x.com/a' : '1,000원'));
      }
    }
    if (await p.locator('#bNext').isDisabled()){ await p.waitForTimeout(800); continue; }
    await p.locator('#bNext').click(); await p.waitForTimeout(450);
  }
  await p.waitForSelector('.done', {timeout:60000});
  return (await p.locator('.pend').count()) > 0;
}

(async () => {
  const br = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await br.newContext({viewport:{width:390,height:844}});
  const p = await ctx.newPage();

  const methods = [];
  p.on('request', r => { if (r.url().includes('/exec')) methods.push(r.method()); });

  /* 앞선 실행이 남긴 설정을 지우고 시작한다 */
  await p.goto(BASE + '/survey.html', {waitUntil:'domcontentloaded'});
  await p.evaluate(u => fetch(u), BASE + '/_nopost?on=0');

  console.log('\n═══ 1. doPost 가 있는 서버 — POST 로 보낸다 ═══');
  const before = await p.evaluate(u => fetch(u).then(r=>r.json()).catch(()=>null),
                                  BASE + '/_dump?tab=' + encodeURIComponent('설문_SNS후기'));
  const pend1 = await fill(p, 'POST테스트');
  const rows1 = await p.evaluate(u => fetch(u).then(r=>r.json()).catch(()=>null),
                                 BASE + '/_dump?tab=' + encodeURIComponent('설문_SNS후기'));
  ok(!pend1, '전송 대기 없음');
  ok(methods.filter(m => m === 'POST').length > 0, 'POST 로 보냄 (' + methods.filter(m=>m==='POST').length + '건)');
  ok(methods.filter(m => m === 'GET').length === 0, 'JSONP(GET)는 안 씀');
  ok(people(rows1) - people(before) === 1, '시트에 사람 1명분 저장 (줄 수와 무관)');

  console.log('\n═══ 2. doPost 가 없는 옛 배포 — 예전 방식으로 내려간다 ═══');
  await p.evaluate(u => fetch(u), BASE + '/_nopost?on=1');
  methods.length = 0;
  const before2 = people(rows1);
  const pend2 = await fill(p, 'JSONP테스트');
  const rows2 = await p.evaluate(u => fetch(u).then(r=>r.json()).catch(()=>null),
                                 BASE + '/_dump?tab=' + encodeURIComponent('설문_SNS후기'));
  ok(!pend2, 'POST 가 막혀도 전송 대기 없음');
  ok(methods.filter(m => m === 'GET').length > 0, 'JSONP(GET)로 내려감');
  ok(people(rows2) - before2 === 1, '시트에 사람 1명분 저장 (내용 유실 없음)');

  await br.close();
  console.log(process.exitCode ? '\n실패 있음\n' : '\n전부 통과\n');
})();
