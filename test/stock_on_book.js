/* 예약과 동시에 도안 재고가 빠지는지, 그리고 체크인에서 이중으로 빠지지 않는지 */
const http = require('http');
const BASE = process.env.BASE || 'http://127.0.0.1:8880';
const KEY = '0919';
const ok = (c, m) => { console.log((c ? '  ✅' : '  ❌') + ' ' + m); if (!c) process.exitCode = 1; };
const get = p => new Promise((r,j)=>http.get(BASE+p,x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>r(b))}).on('error',j));
const api = async q => { const t = await get('/exec?' + q); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}')+1)); };
const E = encodeURIComponent;
const dump = tab => get('/_dump?tab=' + E(tab)).then(t => JSON.parse(t));
const remain = async key => {
  const rows = await dump('재고'); const h = rows[0];
  const r = rows.slice(1).find(x => x[0] === key);
  return r ? Number(r[h.indexOf('잔여')]) : null;
};
const book = (name, tel, design, time) =>
  api(`action=book&program=${E('컬러링')}&time=${time||'14:00'}&name=${E(name)}&tel=${E(tel)}&agree=1` +
      (design ? `&design=${E(design)}` : ''));
const checkin = (name, status, design, time) =>
  api(`action=checkin&k=${KEY}&slot=${E('컬러링 ' + (time||'14:00'))}&name=${E(name)}&status=${E(status)}` +
      (design !== undefined ? `&design=${E(design)}` : ''));

(async () => {
  const D1 = '01 소서노', D2 = '03 갯벌';
  const s0 = await remain(D1), g0 = await remain(D2);
  console.log(`\n시작 재고 — ${D1} ${s0} · ${D2} ${g0}`);

  console.log('\n═══ 1. 예약하면 바로 빠진다 ═══');
  let r = await book('김예약', '010-1000-0001', D1);
  ok(r.ok === true, '예약 접수됨');
  ok(await remain(D1) === s0 - 1, `${D1} 재고 ${s0} → ${await remain(D1)}`);

  console.log('\n═══ 2. 홈페이지 잔여 표시에도 반영 ═══');
  const slots = await api('action=slots');
  const shown = (slots.sheetStock || []).find(x => x.key === D1);
  ok(shown && shown.remain === s0 - 1, `홈페이지 잔여 ${shown && shown.remain}`);

  console.log('\n═══ 3. 담당자 화면에 예약 도안이 미리 보인다 ═══');
  const desk = await api(`action=desk&k=${KEY}&slot=${E('컬러링 14:00')}`);
  const me = (desk.people || []).find(x => x.name === '김예약');
  ok(!!me, '명단에 있음');
  ok(me.design === D1, `예약한 도안이 선택된 상태로 표시: ${me.design}`);
  ok(me.booked === D1, `booked 필드에도 기록: ${me.booked}`);

  console.log('\n═══ 4. 체크인해도 또 빠지지 않는다 (이중 차감 방지) ═══');
  await checkin('김예약', '참석', D1);
  ok(await remain(D1) === s0 - 1, `${D1} 재고 그대로 ${await remain(D1)} (1장만 소진)`);

  console.log('\n═══ 5. 현장에서 도안을 바꾸면 맞바꾼다 ═══');
  await checkin('김예약', '참석', D2);
  ok(await remain(D1) === s0, `${D1} 되돌아옴 ${await remain(D1)}`);
  ok(await remain(D2) === g0 - 1, `${D2} 빠짐 ${await remain(D2)}`);

  console.log('\n═══ 6. 노쇼면 도안을 놓아준다 ═══');
  await checkin('김예약', '노쇼', D2);
  ok(await remain(D2) === g0, `${D2} 되돌아옴 ${await remain(D2)}`);
  console.log('   (다시 참석 처리)');
  await checkin('김예약', '참석', D2);
  ok(await remain(D2) === g0 - 1, `다시 참석하면 또 빠짐 ${await remain(D2)}`);

  console.log('\n═══ 7. 도안을 안 고르고 예약하면 안 빠진다 ═══');
  const before = await remain(D1);
  await book('이미정', '010-1000-0002', '', '14:30');
  ok(await remain(D1) === before, '재고 변화 없음');
  console.log('   (현장에서 고르면 그때 빠진다)');
  await checkin('이미정', '참석', D1, '14:30');
  ok(await remain(D1) === before - 1, `현장 선택 시 빠짐 ${await remain(D1)}`);

  console.log('\n═══ 8. 품절 도안은 예약이 막힌다 ═══');
  const left = await remain('04 수봉폭포');
  for (let i = 0; i < left; i++) {
    const t = ['13:00','13:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','14:00'][i % 10];
    await book('소진' + i, '010-2000-' + String(1000 + i), '04 수봉폭포', t);
  }
  ok(await remain('04 수봉폭포') === 0, `수봉폭포 ${left}장 모두 소진`);
  const blocked = await book('막힘', '010-3000-0001', '04 수봉폭포', '13:00');
  ok(blocked.ok === false && /마감/.test(blocked.error || ''), '품절 도안 예약 거절: ' + blocked.error);

  console.log('\n═══ 9. 다른 도안은 여전히 예약된다 ═══');
  const any = await book('정상', '010-3000-0002', '02 문학산성', '13:30');
  ok(any.ok === true, '다른 도안은 정상 접수');
})();

/* ── 10. 이미 들어온 예약분 맞추기 (syncSheetStock) ── */
(async () => {
  await new Promise(r => setTimeout(r, 3000));   // 위 시나리오가 끝난 뒤
  console.log('\n═══ 10. syncSheetStock() — 기록과 다시 맞추기 ═══');
  const runFn = f => get('/_run?fn=' + f).then(t => JSON.parse(t));
  // 차감을 일부러 틀어놓는다 (예전 예약이 차감 안 된 상황을 흉내)
  await get('/_skew?tab=' + E('재고') + '&key=' + E('01 소서노') + '&used=0');
  const skewed = await remain('01 소서노');
  console.log('   차감을 0으로 틀어놓음 → 잔여', skewed);
  const r = await runFn('syncSheetStock');
  ok(r.ok === true, 'syncSheetStock 실행됨');
  ok(r.changed.some(x => x.includes('01 소서노')), '틀어진 항목을 바로잡음: ' + r.changed.join(' / '));
  const fixed = await remain('01 소서노');
  ok(fixed === 30 - (r.held['01 소서노'] || 0), `잔여가 실제 나간 장수와 맞음 (${fixed})`);
  // 두 번 돌려도 같아야 한다
  const again = await runFn('syncSheetStock');
  ok(again.changed.length === 0, '두 번째 실행은 바꿀 게 없음 (멱등)');
  ok(await remain('01 소서노') === fixed, '값도 그대로');
})();
