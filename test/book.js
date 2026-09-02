const { chromium } = require('playwright');
const BASE='http://127.0.0.1:8802';
const ok=(c,m)=>{ console.log((c?'  ✅':'  ❌')+' '+m); if(!c) process.exitCode=1; };
const errs=[];

async function book(page, {program,time,name,tel,design}){
  await page.goto(BASE+'/reserve.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1200);
  await page.locator('[data-prog="'+program+'"]').click(); await page.waitForTimeout(400);
  const t=page.locator('[data-time="'+time+'"]');
  if (await t.isDisabled()) return {blocked:'마감'};
  await t.click(); await page.waitForTimeout(250);
  await page.locator('#fName').fill(name);
  await page.locator('#fTel').fill(tel);
  if (design) { await page.locator('[data-design="'+design+'"]').click(); await page.waitForTimeout(250); }
  await page.locator('#agree').click(); await page.waitForTimeout(250);
  await page.locator('#submit').click();
  await page.waitForTimeout(1600);
  if (await page.locator('.done').count()) return {ok:true, ticket:(await page.locator('.ticket .v').textContent()).trim()};
  return {err:(await page.locator('#err').textContent()).trim()};
}

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx=await b.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  p.on('pageerror',e=>errs.push(e.message));

  console.log('\n═══ 1. 화면 ═══');
  await p.goto(BASE+'/reserve.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1500);
  ok(await p.locator('[data-prog]').count()===2, '프로그램 2종');
  ok(await p.locator('#submit').isDisabled(), '아무것도 안 고르면 예약 버튼 비활성');
  await p.locator('[data-prog="컬러링"]').click(); await p.waitForTimeout(500);
  ok(await p.locator('[data-time]').count()===10, '회차 10개 표시 ('+await p.locator('[data-time]').count()+')');
  const firstLabel = await p.locator('[data-time]').first().textContent();
  ok(firstLabel.includes('잔여'), '잔여 인원 표시: "'+firstLabel.trim().replace(/\s+/g,' ')+'"');
  ok(await p.locator('[data-design]').count()===5, '도안 5종');

  console.log('\n═══ 2. 필수값 검증 ═══');
  await p.locator('[data-time="14:00"]').click(); await p.waitForTimeout(250);
  ok(await p.locator('#submit').isDisabled(), '이름·연락처·동의 없으면 비활성');
  await p.locator('#fName').fill('홍길동'); await p.locator('#fTel').fill('010-1111-2222');
  await p.waitForTimeout(200);
  ok(await p.locator('#submit').isDisabled(), '동의 안 하면 여전히 비활성');
  await p.locator('#agree').click(); await p.waitForTimeout(300);
  ok(!(await p.locator('#submit').isDisabled()), '전부 채우면 활성화');

  console.log('\n═══ 3. 예약 접수 ═══');
  await p.locator('#submit').click(); await p.waitForTimeout(1800);
  ok(await p.locator('.done').count()===1, '완료 화면');
  console.log('    티켓:', (await p.locator('.ticket .v').textContent()).trim(), '/', (await p.locator('.ticket .d').textContent()).trim().replace(/\s+/g,' '));

  console.log('\n═══ 4. 시트에 제대로 들어갔나 ═══');
  const rows = await p.evaluate(async()=>(await fetch('/_dump?tab='+encodeURIComponent('설문지 응답 시트1'))).json());
  console.log('    헤더:', rows[0].join(' | '));
  console.log('    1행 :', rows[1].join(' | '));
  ok(rows[0].includes('참여 프로그램') && rows[0].includes('예약 시간'), '기존 폼 헤더 그대로 사용');
  const m=Object.fromEntries(rows[0].map((h,i)=>[h,rows[1][i]]));
  ok(m['참여 프로그램']==='컬러링' && m['예약 시간']==='14:00', '프로그램·시간 정확한 칸에 기록');
  ok(m['이름']==='홍길동' && m['연락처']==='010-1111-2222', '이름·연락처 기록');

  console.log('\n═══ 5. 중복 예약 차단 ═══');
  const dup = await book(p,{program:'컬러링',time:'14:00',name:'홍길동',tel:'010-1111-2222'});
  const rows2 = await p.evaluate(async()=>(await fetch('/_dump?tab='+encodeURIComponent('설문지 응답 시트1'))).json());
  ok(rows2.length===2, '같은 사람·같은 회차는 행이 안 늘어남 (현재 '+(rows2.length-1)+'건)');

  console.log('\n═══ 6. 정원 초과 차단 (컬러링 6명) ═══');
  for (let i=2;i<=6;i++){
    const r = await book(p,{program:'컬러링',time:'14:00',name:'참가자'+i,tel:'010-0000-000'+i});
    if (!r.ok) console.log('    '+i+'번째 실패:', r.err||r.blocked);
  }
  const rows3 = await p.evaluate(async()=>(await fetch('/_dump?tab='+encodeURIComponent('설문지 응답 시트1'))).json());
  ok(rows3.length-1===6, '정확히 6명까지 접수 (현재 '+(rows3.length-1)+'명)');

  const over = await book(p,{program:'컬러링',time:'14:00',name:'초과자',tel:'010-9999-9999'});
  ok(over.blocked==='마감' || (over.err||'').includes('마감'), '7번째는 차단됨 ('+(over.blocked||over.err)+')');

  console.log('\n═══ 7. 동시 접수 (마지막 한 자리에 3명이 동시에) ═══');
  const seed = await p.evaluate(async()=>{
    // 15:00 회차에 5명 채우고 마지막 1자리를 남긴다
    for (let i=1;i<=5;i++){
      await fetch('/exec?action=book&program=컬러링&time=15:00&name=선점'+i+'&tel=010-5555-000'+i+'&agree=1');
    }
    // 3명이 동시에 마지막 자리를 노린다
    const rs = await Promise.all([1,2,3].map(i=>
      fetch('/exec?action=book&program=컬러링&time=15:00&name=동시'+i+'&tel=010-7777-000'+i+'&agree=1').then(r=>r.json())));
    return rs;
  });
  const won = seed.filter(r=>r.ok!==false).length;
  console.log('    결과:', seed.map(r=>r.ok===false?('거절: '+r.error.slice(0,20)):'성공').join(' / '));
  ok(won===1, '한 명만 성공, 나머지는 거절 (성공 '+won+'명)');

  const rows4 = await p.evaluate(async()=>(await fetch('/_dump?tab='+encodeURIComponent('설문지 응답 시트1'))).json());
  const c15 = rows4.slice(1).filter(r=>r[2]==='15:00').length;
  ok(c15===6, '15:00 회차 정확히 6명 (현재 '+c15+'명) — 정원 초과 없음');

  console.log('\n═══ 8. 예약 현황에 반영 ═══');
  const rep = await p.evaluate(async()=>(await fetch('/exec')).json());
  const s14 = rep.slots.filter(s=>s.program==='컬러링'&&s.time==='14:00')[0];
  ok(s14.remain===0, '14:00 잔여 0으로 표시');

  await b.close();
  console.log('\nJS 오류: '+(errs.length?errs.join(' | '):'0건'));
})().catch(e=>{console.error('하네스 실패:',e);process.exit(1);});
