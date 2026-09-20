/* 설문 더미를 만들어 CSV 로 뽑는다. 실제 Code.gs 를 그대로 돌리므로,
   현장 시트에 어떤 모습으로 쌓이는지 그대로 보여준다.

     node test/server.js 8871 &            # 또는 MAX_URL=900 을 줘서 주소 길이 한계를 흉내낸다
     node test/dummy_survey.js             # /tmp/dummy_survey.csv 생성

   한 사람이 여러 줄로 남는다(주소 길이 때문에 문항을 나눠 보낸다).
   둘째 줄부터 이름 뒤에 '(이어짐 2)' 가 붙으므로 그것으로 다시 합친다. */
const { chromium } = require('playwright');
const fs = require('fs');
const B = process.env.HM_BASE || 'http://127.0.0.1:8871';
const PEOPLE = [
  { name:'김서연', slot:'컬러링 15:00', pick:0, txt:'아이가 소서노 도안을 너무 좋아했어요. 색칠하는 내내 집중했습니다.' },
  { name:'박준호', slot:'컬러링 16:30', pick:1, txt:'수봉폭포 그림이 예뻐서 골랐는데 실제 장소도 가보고 싶어졌습니다.' },
  { name:'이하늘', slot:'컬러링 17:30', pick:2, txt:'붓과 팔레트가 잘 준비돼 있어 편했어요. 시간이 조금 짧은 게 아쉽습니다.' }
];
(async()=>{
  const br = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await br.newContext({viewport:{width:390,height:844}});
  for (const c of PEOPLE){
    const p = await ctx.newPage();
    const lens = [];
    p.on('request', r => { if (r.url().includes('action=survey')) lens.push(r.url().length); });
    await p.goto(B+'/survey.html?t=coloring&slot='+encodeURIComponent(c.slot)+'&name='+encodeURIComponent(c.name),
                 {waitUntil:'networkidle'});
    await p.waitForTimeout(300);
    let g=0;
    while(g++<20){
      if (await p.locator('.done').count()) break;
      for (const q of await p.locator('.q').all()){
        const sc = await q.locator('.scale').all();
        if (sc.length){ for (const x of sc) await x.locator('button').nth(3 + (c.pick % 2)).click(); continue; }
        const o = await q.locator('.opt').all();
        if (o.length){ if(!(await q.locator('.opt.on').count())) await o[Math.min(o.length-1, c.pick)].click(); continue; }
        const ta = q.locator('textarea'); if (await ta.count()) await ta.fill(c.txt);
        for (const sh of await q.locator('input[data-t]').all()){
          const t=(await sh.getAttribute('data-t'))||'';
          await sh.fill(t.includes('이름')?c.name:(t.includes('링크')?'':'12,000원'));
        }
      }
      await p.locator('#bNext').click(); await p.waitForTimeout(450);
    }
    await p.waitForSelector('.done',{timeout:60000});
    const pend = await p.locator('.pend').count();
    console.log('  '+c.name+' — 요청 '+lens.length+'건 · 가장 긴 주소 '+Math.max(...lens)+'자 · '+(pend?'대기':'저장 완료'));
    await p.close();
  }
  const page = await ctx.newPage();
  await page.goto(B+'/survey.html',{waitUntil:'domcontentloaded'});
  const rows = await page.evaluate(u=>fetch(u).then(r=>r.json()), B+'/_dump?tab='+encodeURIComponent('설문_컬러링체험'));
  const csv = rows.map(r=>r.map(v=>{
    const s = String(v==null?'':v);
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }).join(',')).join('\n');
  fs.writeFileSync('/tmp/dummy_survey.csv', '﻿'+csv);
  console.log('\n  시트: '+(rows.length-1)+'줄 · 컬럼 '+rows[0].length+'개');
  await br.close();
})();
