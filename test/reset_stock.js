/* resetStock() 이 재고 탭을 설정과 맞추는지 — 이미 나간 수량은 지키는지 확인한다 */
const http = require('http');
const BASE = process.env.BASE || 'http://127.0.0.1:8799';
const ok = (c, m) => { console.log((c ? '  ✅' : '  ❌') + ' ' + m); if (!c) process.exitCode = 1; };
const get = p => new Promise((res, rej) =>
  http.get(BASE + p, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(b)); }).on('error', rej));
const dump = async () => JSON.parse(await get('/_dump?tab=' + encodeURIComponent('재고')));

(async () => {
  console.log('\n═══ resetStock() ═══');

  // 예전 구성(도안 5종 × 12장)을 흉내 내려고, 지금 행에 옛날 값을 직접 써 넣는다
  const before = await dump();
  console.log('  현재 재고 탭:', before.length - 1, '행');

  // 실제로 몇 개를 소진시킨다 — 체크인으로 도안을 차감
  await get('/exec?action=checkin&slot=' + encodeURIComponent('컬러링 13:00') +
            '&name=' + encodeURIComponent('참가자1') + '&status=' + encodeURIComponent('참석') +
            '&design=' + encodeURIComponent('01 소서노') + '&k=0919&cb=x');
  const mid = await dump();
  const h = mid[0], row = k => mid.slice(1).find(r => r[0] === k);
  const usedIdx = h.indexOf('차감'), totIdx = h.indexOf('초기수량'), remIdx = h.indexOf('잔여');
  const so = row('01 소서노');
  ok(Number(so[usedIdx]) === 1, '소서노 1장 차감됨 (차감 ' + so[usedIdx] + ')');

  // 설정에 없는 옛 품목을 하나 끼워 넣는다 (05 수봉도서관 상황)
  await get('/_inject_stock?key=' + encodeURIComponent('05 수봉도서관') + '&total=12');
  ok((await dump()).slice(1).some(r => r[0] === '05 수봉도서관'), '옛 품목을 재고 탭에 넣어둠');

  // resetStock 실행
  const out = JSON.parse(await get('/_run?fn=resetStock'));
  ok(out.ok === true, 'resetStock 실행됨 (품목 ' + out.items + '종)');

  const after = await dump();
  const rows = after.slice(1).filter(r => r[0]);
  ok(rows.length === 8, '재고 8종으로 정리됨 (' + rows.length + ')');
  ok(!rows.some(r => r[0] === '05 수봉도서관'), '설정에 없는 05 수봉도서관이 내려감');
  ok(out.dropped.includes('05 수봉도서관'), '내려간 품목을 로그로 알려줌');

  const want = { '01 소서노': 30, '02 문학산성': 30, '03 갯벌': 30, '04 수봉폭포': 10,
                 '바인더 체험': 50, '바인더 완성품': 50, '스티커': 100, '액자': 28 };
  let allTot = true;
  for (const [k, v] of Object.entries(want)) {
    const r = rows.find(x => x[0] === k);
    if (!r || Number(r[totIdx]) !== v) { allTot = false; console.log('     ✗', k, '초기수량', r && r[totIdx], '≠', v); }
  }
  ok(allTot, '초기수량이 전부 새 설정대로 (소서노 30 · 수봉폭포 10 …)');

  const so2 = rows.find(r => r[0] === '01 소서노');
  ok(Number(so2[usedIdx]) === 1, '이미 나간 1장이 지켜짐 (차감 ' + so2[usedIdx] + ')');
  ok(Number(so2[remIdx]) === 29, '잔여가 30-1 = 29 로 다시 계산됨 (' + so2[remIdx] + ')');

  const raw = await get('/exec?action=slots');
  const slots = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const sheet = (slots.sheetStock || []);
  ok(sheet.length === 4, '홈페이지에 내려가는 도안 재고도 4종 (' + sheet.length + ')');
  console.log('  ' + sheet.map(x => x.key + ' ' + x.remain).join(' · '));
})();
