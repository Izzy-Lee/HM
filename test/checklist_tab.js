/* setupChecklist() 가 체크박스 달린 준비물 탭을 제대로 만드는지 */
const http = require('http');
const BASE = process.env.BASE || 'http://127.0.0.1:8860';
const ok = (c, m) => { console.log((c ? '  ✅' : '  ❌') + ' ' + m); if (!c) process.exitCode = 1; };
const get = p => new Promise((r,j)=>http.get(BASE+p,x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>r(b))}).on('error',j));
const run  = fn => get('/_run?fn=' + fn).then(t => { try { return JSON.parse(t); } catch(e){ throw new Error(t.slice(0,400)); } });
const dump = tab => get('/_dump?tab=' + encodeURIComponent(tab)).then(t => JSON.parse(t));

(async () => {
  console.log('\n═══ setupChecklist() ═══');
  const r = await run('setupChecklist');
  ok(r.created === true, '준비물 탭 생성됨 — 항목 ' + r.items + '개 / 소제목 ' + r.sections + '개');

  const rows = await dump('준비물');
  ok(rows[0].join('|') === '✔|항목|수량|비고', '헤더: ' + rows[0].join(' | '));

  const body = rows.slice(1);
  const sections = body.filter(x => x[0] === '' && x[2] === '' && x[3] === '' && /[🌙🚗🏗📱📸🍱🧹]/.test(String(x[1])));
  const items = body.filter(x => x[0] === false || x[0] === true);
  ok(sections.length === 10, '소제목 10개 (' + sections.length + ')');
  ok(items.length === r.items, '체크박스가 항목 수만큼 (' + items.length + ')');
  ok(sections.every(x => x[0] === ''), '소제목 줄에는 체크박스 없음');

  // 계획서 핵심 항목이 빠지지 않았는지
  const txt = body.map(x => String(x[1])).join('\n');
  for (const must of ['수채화 물감 44색 세트','체험용 수채화지','종이바인더','레진','액자',
                      '실외 배너','홍보용 풍선','참석자 명단','행사사진 원본','다과 (음료·간식)','식비',
                      '운영 리뷰 회의 + 회의록']) {
    ok(txt.includes(must), '계획서 항목 포함: ' + must);
  }
  const sheets = body.find(x => String(x[1]) === '체험용 수채화지');
  ok(String(sheets[2]) === '100장' && String(sheets[3]).includes('수봉폭포 10'), '수채화지 수량이 최신값: ' + sheets[2] + ' / ' + sheets[3]);
  const stk = body.find(x => String(x[1]) === '조각 스티커');
  ok(String(stk[3]).includes('2,500'), '스티커 가격이 2,500원으로: ' + stk[3]);

  console.log('\n═══ 두 번 실행해도 체크가 안 날아가나 ═══');
  // 사람이 몇 개 체크한 상태를 흉내낸다
  await get('/_tick?tab=' + encodeURIComponent('준비물') + '&row=3');
  const before = (await dump('준비물'))[2][0];
  ok(before === true, '3행을 체크한 상태로 만듦');
  const again = await run('setupChecklist');
  ok(again.created === false, '이미 있으면 다시 만들지 않음');
  ok((await dump('준비물'))[2][0] === true, '체크해 둔 것이 그대로 남음');

  console.log('\n  총 항목 ' + r.items + '개');
})();
