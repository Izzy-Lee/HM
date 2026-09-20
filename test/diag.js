/* 진단 화면이 실제로 원인을 가려내는지 확인한다.
   서버가 action=survey 만 거부하는 상황을 하네스에서 만들어 놓고,
   화면이 '회차 조회는 정상 · 설문은 실패' 로 정확히 갈라 보여주는지 본다. */
const { chromium } = require('playwright');
const BASE = process.env.HM_BASE || 'http://127.0.0.1:8875';
const ok = (c,m) => { console.log((c?'  ✅':'  ❌')+' '+m); if(!c) process.exitCode = 1; };

(async () => {
  const br = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const p = await (await br.newContext({viewport:{width:390,height:844}})).newPage();

  console.log('\n═══ 서버가 멀쩡할 때 ═══');
  await p.goto(BASE + '/survey.html?diag=1', {waitUntil:'networkidle'});
  await p.waitForTimeout(2500);
  let txt = await p.locator('#root').textContent();
  ok(/1\. 회차 조회 \(JSONP\)[\s\S]*?정상/.test(txt), '회차 조회 정상으로 표시');
  ok(/2\. 설문 최소 전송 \(JSONP\)[\s\S]*?정상/.test(txt), '설문 최소 전송 정상으로 표시');
  ok(/HTTP 200/.test(txt), 'fetch 응답 코드 표시 (HTTP 200)');
  ok(/주소 \d+자/.test(txt), '주소 길이 표시');

  console.log('\n═══ 서버가 설문만 거부할 때 (현장 증상 재현) ═══');
  await p.goto(BASE + '/survey.html?diag=1&block=1', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  txt = await p.locator('#root').textContent();
  ok(/1\. 회차 조회 \(JSONP\)[\s\S]*?정상/.test(txt), '회차 조회는 여전히 정상');
  ok(/2\. 설문 최소 전송 \(JSONP\)[\s\S]*?(실패|거절)/.test(txt), '설문만 실패로 갈라냄');
  ok(/4\. 설문 최소 전송 \(fetch\)[\s\S]*?(HTTP 5\d\d|불러오기 실패)/.test(txt),
     'fetch 가 실제 응답 코드/사유를 보여줌');

  console.log('\n  화면에 찍힌 내용:');
  console.log('  ' + txt.replace(/\s+/g,' ').slice(0, 400));

  await br.close();
  console.log(process.exitCode ? '\n실패 있음\n' : '\n전부 통과\n');
})();
