const { chromium } = require('playwright');
const BASE='http://127.0.0.1:8790', KEY='michu919';
const ok=(c,m)=>{ console.log((c?'  ✅':'  ❌')+' '+m); if(!c) process.exitCode=1; };
const errs=[];

/** 한 설문을 끝까지 채워 제출한다 */
async function fillSurvey(page, type, opts={}){
  const url = BASE+'/survey.html?t='+type + (opts.slot?'&slot='+encodeURIComponent(opts.slot):'') + (opts.name?'&name='+encodeURIComponent(opts.name):'');
  await page.goto(url,{waitUntil:'networkidle'});
  await page.waitForTimeout(300);
  let guard=0;
  while (guard++ < 20){
    if (await page.locator('.done').count()) break;
    // 필수 항목 채우기: 라디오/멀티는 첫 옵션, 척도는 첫 버튼
    const cards = await page.locator('.q').all();
    for (const c of cards){
      const scales = await c.locator('.scale').all();
      if (scales.length){
        for (const sc of scales){ await sc.locator('button').first().click(); }
        continue;
      }
      const opts2 = await c.locator('.opt').all();
      if (opts2.length){
        const anyOn = await c.locator('.opt.on').count();
        if (!anyOn) await opts2[0].click();
        continue;
      }
      const ta = c.locator('textarea');
      if (await ta.count()) await ta.fill(opts.long ? '가'.repeat(280) : '테스트 의견입니다');
      const sh = c.locator('input[data-t]');
      if (await sh.count()) await sh.fill('10,000원');
    }
    await page.locator('#bNext').click();
    await page.waitForTimeout(600);
  }
  await page.waitForSelector('.done', {timeout:15000});
  const code = await page.locator('.code .cv').count() ? (await page.locator('.code .cv').textContent()).trim() : '';
  const pend = await page.locator('.pend').count() > 0;
  return { code, pend };
}

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  page.on('pageerror',e=>errs.push('PAGE ERROR: '+e.message));
  page.on('console',m=>{ if(m.type()==='error' && !m.text().includes('fonts.googleapis') && !m.text().includes('favicon')) errs.push('console: '+m.text()); });

  console.log('\n═══ 1. 설문 선택 화면 ═══');
  await page.goto(BASE+'/survey.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(400);
  ok(await page.locator('.pb').count()===5, '설문 5종 표시 (체험2 · 구매2 · SNS후기1)');
  ok((await page.locator('.pb').allTextContents()).filter(t=>t.includes('스티커를 드립니다')).length===3,
     '유료 3종에만 스티커 안내 (무료 컬러링 제외)');
  ok((await page.locator('.pb').allTextContents()).filter(t=>t.includes('액자를 드립니다')).length===1,
     'SNS 후기는 액자 안내');

  console.log('\n═══ 2. 컬러링 체험 설문 (무료 · 증정 없음) ═══');
  const r1 = await fillSurvey(page,'coloring',{slot:'컬러링 13:30',name:'참가자1'});
  ok(r1.code==='', '무료 설문은 증정 코드 없음');
  ok(!r1.pend, '정상 전송');

  console.log('\n═══ 3. 자개바인더 구매 설문 (주관식 280자 · 조각 전송) ═══');
  const r2 = await fillSurvey(page,'binder_buy',{slot:'바인더 14:00',name:'구매자A',long:true});
  ok(/^HM-[A-Z0-9]{4}$/.test(r2.code), '증정 코드 발급: '+r2.code);
  ok(!r2.pend, '긴 주관식도 누락 없이 전송');

  console.log('\n═══ 4. 서버에 실제로 저장됐는지 ═══');
  const rep = await page.evaluate(async()=>(await fetch('/exec?action=report')).json());
  ok(rep.survey.count===2, '설문 응답 2건 집계 (현재 '+rep.survey.count+')');
  ok(rep.survey.byType.coloring.count===1 && rep.survey.byType.binder_buy.count===1, '종류별로 정확히 분리');
  ok(rep.survey.experience===1 && rep.survey.purchase===1, '체험 1 / 구매 1');

  // 280자 주관식이 온전히 저장됐는지
  const sheets = await page.evaluate(async()=>(await fetch('/exec?action=_dump')).json().catch(()=>null));

  console.log('\n═══ 5. 스티커 증정 코드 확인 (staff.html) ═══');
  const st = await ctx.newPage();
  st.on('pageerror',e=>errs.push('STAFF PAGE ERROR: '+e.message));
  await st.goto(BASE+'/staff.html?k='+KEY+'&staff=김운영',{waitUntil:'networkidle'});
  await st.waitForTimeout(1200);
  const stockBefore = await st.locator('#stocks input[data-item="스티커"]').inputValue().catch(()=>'?');

  await st.locator('#giftCode').fill(r2.code);
  await st.locator('#giftBtn').click();
  await st.waitForTimeout(1800);
  const msg1 = (await st.locator('#giftMsg').textContent()).trim();
  ok(msg1.includes('데코 스티커 1개를 드리세요'), '유효 코드 → 증정 승인: "'+msg1+'"');

  console.log('\n═══ 6. 같은 코드 재사용 차단 ═══');
  await st.locator('#giftCode').fill(r2.code);
  await st.locator('#giftBtn').click();
  await st.waitForTimeout(1800);
  const msg2 = (await st.locator('#giftMsg').textContent()).trim();
  ok(msg2.includes('이미 증정'), '두 번째 시도 거절: "'+msg2+'"');

  console.log('\n═══ 7. 없는 코드 ═══');
  await st.locator('#giftCode').fill('HM-ZZZZ');
  await st.locator('#giftBtn').click();
  await st.waitForTimeout(1800);
  ok((await st.locator('#giftMsg').textContent()).includes('없는 코드'), '존재하지 않는 코드 거절');

  console.log('\n═══ 8. 재고·매출 영향 ═══');
  await st.reload({waitUntil:'networkidle'}); await st.waitForTimeout(1500);
  const rep2 = await st.evaluate(async()=>(await fetch('/exec?action=report')).json());
  ok(rep2.sales.revenue===0, '증정은 매출 0원 유지 (현재 '+rep2.sales.revenue+')');
  ok((rep2.sales.byItem['스티커']||{}).qty===0, '스티커 판매 수량은 그대로 0 (증정과 분리)');
  ok((rep2.sales.byItem['스티커 증정']||{}).qty===1, '스티커 증정 1개로 별도 집계');
  const stk = rep2.stock.filter(x=>x.key==='스티커')[0];
  ok(stk.used===1 && stk.remain===99, '스티커 재고에서 1개 차감 (잔여 '+stk.remain+')');
  ok(rep2.survey.stickerGift===1 && rep2.survey.gifted===1, '설문 증정 건수 집계');

  console.log('\n═══ 9. 임시저장 (중간에 화면 닫았다 다시 열기) ═══');
  const dp = await ctx.newPage();
  await dp.goto(BASE+'/survey.html?t=sticker',{waitUntil:'networkidle'});
  await dp.waitForTimeout(400);
  await dp.locator('.q').first().locator('.opt').first().click();
  await dp.waitForTimeout(300);
  await dp.reload({waitUntil:'networkidle'});
  await dp.waitForTimeout(500);
  ok(await dp.locator('.q').first().locator('.opt.on').count()===1, '새로고침해도 응답 유지');

  console.log('\n═══ 10. 필수 문항 검증 ═══');
  await dp.goto(BASE+'/survey.html?t=sticker',{waitUntil:'networkidle'});
  await dp.evaluate(()=>localStorage.clear());
  await dp.reload({waitUntil:'networkidle'}); await dp.waitForTimeout(500);
  await dp.locator('#bNext').click();
  await dp.waitForTimeout(400);
  ok(await dp.locator('#err.on').count()===1, '빈 채로 다음 누르면 경고');
  ok(await dp.locator('.q.miss').count()>0, '누락 문항 붉게 표시 ('+await dp.locator('.q.miss').count()+'개)');

  await browser.close();
  console.log('\n═══ 콘솔 ═══');
  console.log(errs.length ? errs.join('\n') : 'JS 오류 0건');
  if (errs.length) process.exitCode=1;
})().catch(e=>{console.error('하네스 실패:',e);process.exit(1);});
