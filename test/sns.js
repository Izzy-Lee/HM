const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const BASE='http://127.0.0.1:8790', KEY='michu919';
const ok=(c,m)=>{ console.log((c?'  ✅':'  ❌')+' '+m); if(!c) process.exitCode=1; };
const errs=[];

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx=await b.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  p.on('pageerror',e=>errs.push(e.message));

  console.log('\n═══ 1. SNS 후기 설문 화면 ═══');
  await p.goto(BASE+'/survey.html',{waitUntil:'domcontentloaded'});
  await p.waitForSelector('.pb'); await p.waitForTimeout(300);
  ok(await p.locator('.pb').count()===5, '설문 5종으로 늘어남 ('+await p.locator('.pb').count()+')');
  const snsCard = await p.locator('.pb').filter({hasText:'SNS 후기'}).textContent();
  ok(snsCard.includes('액자'), 'SNS 후기는 액자 안내: "'+snsCard.trim().replace(/\s+/g,' ').slice(0,60)+'"');

  await p.goto(BASE+'/survey.html?t=sns&slot='+encodeURIComponent('컬러링 15:00'),{waitUntil:'domcontentloaded'});
  await p.waitForSelector('.q'); await p.waitForTimeout(400);
  ok(await p.locator('#photoBtn').count()===1, '사진 첨부 버튼 있음');

  console.log('\n═══ 2. 필수값 (사진 포함) ═══');
  await p.locator('#bNext').click(); await p.waitForTimeout(500);
  ok(await p.locator('.q.miss').count()>=3, '이름·링크·사진·플랫폼 누락 표시 ('+await p.locator('.q.miss').count()+'개)');

  console.log('\n═══ 3. 큰 사진을 넣으면 자동으로 줄이는가 ═══');
  // 2400x1800 짜리 큰 이미지를 만들어 첨부한다
  const bigPng = await p.evaluate(()=>{
    const cv=document.createElement('canvas'); cv.width=2400; cv.height=1800;
    const cx=cv.getContext('2d');
    const g=cx.createLinearGradient(0,0,2400,1800);
    g.addColorStop(0,'#14796a'); g.addColorStop(1,'#b8620f');
    cx.fillStyle=g; cx.fillRect(0,0,2400,1800);
    cx.fillStyle='#fff'; cx.font='bold 160px sans-serif'; cx.fillText('헬로미추 후기',200,900);
    return cv.toDataURL('image/png');
  });
  const buf = Buffer.from(bigPng.split(',')[1],'base64');
  const tmp = path.join(__dirname,'big.png');
  fs.writeFileSync(tmp, buf);
  console.log('    원본 크기:', Math.round(buf.length/1024)+'KB (2400x1800 PNG)');

  await p.locator('#photoInput').setInputFiles(tmp);
  await p.waitForTimeout(1500);
  const state = await p.locator('#photoState').textContent();
  ok(state.includes('첨부됨'), '압축 완료: "'+state.trim()+'"');
  const kb = parseInt((state.match(/약 (\d+)KB/)||[])[1]||'0',10);
  ok(kb>0 && kb<300, '100KB 안팎으로 줄어듦 ('+kb+'KB, 원본의 '+Math.round(kb/(buf.length/1024)*100)+'%)');
  ok(await p.locator('.photo-prev').count()===1, '미리보기 표시');

  console.log('\n═══ 4. 제출 → 드라이브 저장 ═══');
  await p.locator('input[data-t="이름"]').fill('후기왕');
  await p.locator('input[data-t="게시물 링크"]').fill('https://instagram.com/p/abc123');
  await p.locator('.q').filter({hasText:'플랫폼'}).locator('.opt').first().click();
  await p.waitForTimeout(300);
  await p.locator('#bNext').click(); await p.waitForTimeout(700);
  // 2섹션
  for (const c of await p.locator('.q').all()){
    const ta=c.locator('textarea'); if(await ta.count()) await ta.fill('도안이 예뻐서 좋았어요');
    const o=c.locator('.opt'); if(await o.count() && !(await c.locator('.opt.on').count())) await o.first().click();
  }
  await p.locator('#bNext').click();
  await p.waitForSelector('.done',{timeout:25000});
  const code=(await p.locator('.code .cv').textContent()).trim();
  const label=(await p.locator('.code .cl').textContent()).trim();
  ok(/^HM-[A-Z0-9]{4}$/.test(code), '증정 코드 발급: '+code);
  ok(label.includes('액자'), '액자 증정 안내 ("'+label+'")');

  console.log('\n═══ 5. 드라이브에 실제 파일이 생겼나 ═══');
  const drive = path.join(__dirname,'drive_mock');
  const walk = d => fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>
    e.isDirectory()? walk(path.join(d,e.name)) : [path.join(d,e.name)]);
  const files = fs.existsSync(drive)? walk(drive) : [];
  files.forEach(f=>console.log('    '+f.replace(drive,'')+'  '+Math.round(fs.statSync(f).size/1024)+'KB'));
  const jpg = files.filter(f=>f.endsWith('.jpg'));
  ok(jpg.length===1, '캡처 이미지 1개 저장됨');
  ok(jpg[0].includes('SNS 후기 캡처'), '전용 하위 폴더에 저장');
  ok(jpg[0].includes('후기왕'), '파일명에 이름 포함');
  const saved = fs.readFileSync(jpg[0]);
  ok(saved[0]===0xFF && saved[1]===0xD8, '온전한 JPEG 파일 (매직바이트 확인)');
  ok(Math.abs(saved.length/1024 - kb) < 5, '올린 크기와 저장 크기 일치 ('+Math.round(saved.length/1024)+'KB)');

  console.log('\n═══ 6. 시트에 링크가 기록됐나 ═══');
  const rows = await p.evaluate(async()=>(await fetch('/_dump?tab='+encodeURIComponent('설문_SNS후기'))).json());
  const m=Object.fromEntries(rows[0].map((h,i)=>[h,rows[1][i]]));
  console.log('    설문종류:', m['설문종류'], '| 이름:', m['이름'], '| 회차:', m['회차']);
  console.log('    게시물 링크:', m['게시물 링크']);
  console.log('    캡처 이미지:', String(m['캡처 이미지']).slice(0,70));
  ok(m['게시물 링크']==='https://instagram.com/p/abc123', '게시물 링크 기록');
  ok(String(m['캡처 이미지']).includes('.jpg'), '드라이브 파일 주소 기록');
  ok(m['증정코드']===code, '증정 코드 기록');

  console.log('\n═══ 7. 액자 증정 (staff.html) ═══');
  const st=await ctx.newPage();
  st.on('pageerror',e=>errs.push('STAFF: '+e.message));
  await st.goto(BASE+'/staff.html?k='+KEY,{waitUntil:'domcontentloaded'});
  await st.waitForTimeout(1500);
  await st.locator('#giftCode').fill(code);
  await st.locator('#giftBtn').click();
  await st.waitForTimeout(2000);
  const msg=(await st.locator('#giftMsg').textContent()).trim();
  ok(msg.includes('드리세요'), '증정 승인: "'+msg+'"');
  const rep=await st.evaluate(async()=>(await fetch('/exec?action=report')).json());
  const frame=rep.stock.filter(x=>x.key==='액자')[0];
  ok(frame.used===1 && frame.remain===27, '액자 재고에서 차감 (잔여 '+frame.remain+') — 스티커 아님');
  ok((rep.sales.byItem['스티커 증정']||{}).qty===0, '스티커는 안 나감');
  ok(rep.survey.sns===1, 'SNS 후기 1건 집계');

  console.log('\n═══ 8. 집계 스냅샷 → 시트 + 드라이브 ═══');
  const snap = await st.evaluate(async(k)=>(await fetch('/exec?action=snapshot&k='+k)).json(), KEY);
  ok(snap.ok && snap.rows>10, '집계 '+snap.rows+'행 기록');
  const agg = await st.evaluate(async()=>(await fetch('/_dump?tab='+encodeURIComponent('집계'))).json());
  console.log('    집계 탭 미리보기:');
  agg.slice(0,6).forEach(r=>console.log('      '+r.filter(Boolean).join(' | ')));
  ok(agg.length>10, '집계 탭에 '+agg.length+'행');
  const files2 = walk(drive);
  ok(files2.some(f=>f.endsWith('.csv')), '드라이브에 CSV 백업');
  ok(files2.some(f=>f.endsWith('.json')), '드라이브에 JSON 백업');

  await b.close();
  console.log('\nJS 오류: '+(errs.length?errs.join(' | '):'0건'));
})().catch(e=>{console.error('하네스 실패:',e);process.exit(1);});
