/* 고객 10명이 홈페이지에서 예약 → 현장 체크인 → 설문/후기까지 남기는
   전체 여정을 무작위로 돌려보고, 그 과정에서 생기는 오류를 잡아낸다.
   실제 index.html / reserve.html / survey.html / staff.html / report.html 과
   실제 apps-script/Code.gs 를 그대로 돌린다. 시트와 드라이브만 목업이다. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const SHOT = path.join(__dirname, '_shot_fixture.jpg');
const BASE = process.env.BASE || 'http://127.0.0.1:8795';
const KEY  = '0919';

const TIMES = ['13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00'];
const DESIGNS = ['01 소서노','02 문학산성','03 갯벌','04 수봉폭포'];
const SURNAME = ['김','이','박','최','정','강','조','윤','장','임'];
const GIVEN   = ['서연','민준','지우','하윤','도윤','서현','예준','수아','지호','유진'];

/* 재현 가능한 난수 — 같은 시드면 같은 시나리오가 나온다 */
let seed = Number(process.env.SEED || 20260919);
const rnd  = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;

const issues = [];      // 확인이 필요한 것
const noted  = [];      // 그냥 기록
const log = (...a) => console.log(...a);
const ok  = (c, m) => { log((c ? '  ✅' : '  ❌') + ' ' + m); if (!c) issues.push(m); };

function hook(page, tag) {
  page.on('pageerror', e => issues.push('[' + tag + '] 스크립트 오류: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    const u = ((m.location() || {}).url) || '';
    // 이 샌드박스는 구글 폰트 CDN 인증서를 못 믿는다. 사이트 코드와 무관하므로 뺀다.
    if (/fonts\.(googleapis|gstatic)/.test(u + t) || /favicon/.test(u + t)) return;
    if (/ERR_CERT_AUTHORITY_INVALID/.test(t) && !u.includes('127.0.0.1')) return;
    issues.push('[' + tag + '] console.error: ' + t.slice(0, 160) + (u ? ' << ' + u.slice(0, 80) : ''));
  });
  page.on('requestfailed', r => {
    const u = r.url();
    if (u.includes('fonts.g') || u.includes('favicon')) return;
    issues.push('[' + tag + '] 요청 실패: ' + u.slice(0, 100) + ' ' + ((r.failure() || {}).errorText || ''));
  });
}

/* ── 한 명이 홈페이지에서 회차를 고르고 예약까지 마친다 ── */
async function journey(ctx, c, n) {
  const page = await ctx.newPage();
  hook(page, '고객' + n);
  try {
    // 1) 홈페이지에 들어와 예약 탭에서 프로그램과 회차를 고른다
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#reserveSlots button.slot-row', { timeout: 20000 })
              .catch(() => issues.push('[고객' + n + '] 예약 회차 목록이 20초 안에 안 떴다'));
    await page.waitForTimeout(400);

    await page.locator('#progTabs button', { hasText: c.program }).first().click();
    await page.waitForTimeout(300);

    const row = page.locator('#reserveSlots button.slot-row', { hasText: c.time }).first();
    if (!(await row.count())) { await page.close(); return { skip: '회차 버튼 없음' }; }
    if (await row.isDisabled()) { await page.close(); return { skip: c.time + ' 마감' }; }
    await row.click();
    await page.waitForTimeout(300);

    const cta = page.locator('.reserve-cta');
    if (await cta.isDisabled()) { await page.close(); return { skip: '예약 버튼이 안 열림' }; }
    const label = (await cta.textContent()).trim();
    if (!label.includes(c.time)) issues.push('[고객' + n + '] 버튼 문구가 고른 회차와 다름: "' + label + '"');
    await cta.click();
    await page.waitForTimeout(1500);

    // 2) 예약 화면 — 홈에서 고른 회차가 그대로 넘어왔는지
    if (!page.url().includes('reserve.html')) { await page.close(); return { skip: '예약 화면으로 안 넘어감' }; }
    const carried = await page.locator('[data-time].on, [data-time][class*="on"]').count();
    if (!carried) noted.push('[고객' + n + '] 예약 화면에서 회차가 자동 선택되지 않음');

    // 홈에서 넘어오면 프로그램·회차가 이미 선택돼 있다. 한 번 더 누르면 해제되므로
    // 켜져 있지 않을 때만 누른다.
    const turnOn = async sel => {
      const el = page.locator(sel);
      if (!(await el.count())) return false;
      if (await el.isDisabled()) return false;
      const cls = (await el.getAttribute('class')) || '';
      if (!/\bon\b/.test(cls)) { await el.click(); await page.waitForTimeout(200); }
      return true;
    };
    if (!(await turnOn('[data-prog="' + c.program + '"]'))) { await page.close(); return { skip: '프로그램 선택 불가' }; }
    if (!(await turnOn('[data-time="' + c.time + '"]'))) { await page.close(); return { skip: c.time + ' 마감(예약화면)' }; }
    await page.locator('#fName').fill(c.name);
    await page.locator('#fTel').fill(c.tel);
    if (c.design) await turnOn('[data-design="' + c.design + '"]');

    if (await page.locator('#submit').isDisabled()) { await page.close(); return { skip: '예약 버튼 비활성' }; }
    await page.locator('#submit').click();
    await page.waitForTimeout(2000);

    if (!(await page.locator('.done').count())) {
      const err = await page.locator('#err').textContent().catch(() => '');
      await page.close();
      return { rejected: (err || '알 수 없음').trim() };
    }
    const ticket = (await page.locator('.ticket .v').first().textContent()).trim();
    await page.close();
    return { ok: true, ticket };
  } catch (e) {
    issues.push('[고객' + n + '] 여정 중 예외: ' + e.message.split('\n')[0]);
    await page.close().catch(() => {});
    return { skip: '예외' };
  }
}

/* ── 설문 한 건을 끝까지 채워 제출한다 ── */
async function survey(ctx, type, c, n) {
  const page = await ctx.newPage();
  hook(page, '설문' + n);
  try {
    await page.goto(BASE + '/survey.html?t=' + type + '&name=' + encodeURIComponent(c.name) +
                    (c.slot ? '&slot=' + encodeURIComponent(c.slot) : ''), { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    let guard = 0;
    while (guard++ < 25) {
      if (await page.locator('.done').count()) break;
      for (const q of await page.locator('.q').all()) {
        const scales = await q.locator('.scale').all();
        if (scales.length) {                       // 척도는 무작위 점수로
          for (const sc of scales) {
            const bs = await sc.locator('button').all();
            await bs[Math.min(bs.length - 1, 2 + Math.floor(rnd() * 3))].click();
          }
          continue;
        }
        const opts = await q.locator('.opt').all();
        if (opts.length) {
          if (!(await q.locator('.opt.on').count())) await opts[Math.floor(rnd() * opts.length)].click();
          continue;
        }
        const ta = q.locator('textarea');
        if (await ta.count()) await ta.fill(pick(['좋았어요','아이가 정말 좋아했습니다','색칠이 재밌었어요','다음에 또 오고 싶어요']));
        const ph = q.locator('#photoInput');
        if (await ph.count()) { await ph.setInputFiles(SHOT); await page.waitForTimeout(1500); continue; }
        const sh = q.locator('input[data-t]');
        if (await sh.count()) {
          const lab = (await q.textContent()) || '';
          if (lab.includes('링크')) await sh.fill('https://instagram.com/p/' + Math.floor(rnd() * 1e9));
          else if (lab.includes('이름')) await sh.fill(c.name);
          else await sh.fill(pick(['10,000원','15,000원','20,000원']));
        }
      }
      await page.locator('#bNext').click();
      await page.waitForTimeout(500);
    }
    const done = await page.locator('.done').count() > 0;
    if (!done) issues.push('[설문' + n + '/' + type + '] 25단계 안에 제출까지 못 감');
    await page.close();
    return done;
  } catch (e) {
    issues.push('[설문' + n + '/' + type + '] 예외: ' + e.message.split('\n')[0]);
    await page.close().catch(() => {});
    return false;
  }
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  {  // SNS 후기 캡처로 올릴 더미 이미지
    const t = await b.newPage();
    const url = await t.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 900;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#4a9c8c'; cx.fillRect(0, 0, 1200, 900);
      cx.fillStyle = '#fff'; cx.font = 'bold 80px sans-serif'; cx.fillText('후기 캡처', 100, 450);
      return cv.toDataURL('image/jpeg', 0.9);
    });
    fs.writeFileSync(SHOT, Buffer.from(url.split(',')[1], 'base64'));
    await t.close();
  }
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  /* 고객 10명 생성 */
  const used = new Set();
  const cust = [];
  for (let i = 0; i < 10; i++) {
    let name;
    do { name = pick(SURNAME) + pick(GIVEN); } while (used.has(name));
    used.add(name);
    cust.push({
      name,
      tel: '010-' + String(1000 + Math.floor(rnd() * 8999)) + '-' + String(1000 + Math.floor(rnd() * 8999)),
      program: chance(0.7) ? '컬러링' : '바인더',
      time: pick(TIMES),
      design: chance(0.75) ? pick(DESIGNS) : '',
    });
  }

  log('\n══════ 고객 10명 · 예약 ══════');
  const booked = [];
  for (let i = 0; i < cust.length; i++) {
    const c = cust[i];
    const r = await journey(ctx, c, i + 1);
    const tag = r.ok ? '예약 완료' : r.rejected ? '거절: ' + r.rejected : '건너뜀: ' + r.skip;
    log('  ' + String(i + 1).padStart(2) + '. ' + c.name.padEnd(4) + ' ' + c.program + ' ' + c.time +
        ' ' + (c.design || '(도안 미선택)').padEnd(10) + ' → ' + tag);
    if (r.ok) { c.slot = c.program + ' ' + c.time; booked.push(c); }
  }
  ok(booked.length > 0, '예약 성공 ' + booked.length + '명 / 10명 시도');

  /* 시트에 제대로 쌓였는지 */
  log('\n══════ 예약 시트 대조 ══════');
  const p0 = await ctx.newPage();
  const rows = await p0.evaluate(async (base) =>
    (await fetch(base + '/_dump?tab=' + encodeURIComponent('설문지 응답 시트1'))).json(), BASE)
    .catch(async () => { await p0.goto(BASE + '/index.html'); return p0.evaluate(async () =>
      (await fetch('/_dump?tab=' + encodeURIComponent('설문지 응답 시트1'))).json()); });
  const head = rows[0];
  const recs = rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  ok(recs.length === booked.length, '시트 행 수 = 예약 성공 수 (' + recs.length + ' / ' + booked.length + ')');
  for (const c of booked) {
    const hit = recs.find(r => r['이름'] === c.name);
    if (!hit) { issues.push(c.name + ' 예약이 시트에 없음'); continue; }
    if (hit['참여 프로그램'] !== c.program) issues.push(c.name + ' 프로그램 불일치: 시트 ' + hit['참여 프로그램'] + ' ≠ ' + c.program);
    if (hit['예약 시간'] !== c.time)        issues.push(c.name + ' 시간 불일치: 시트 ' + hit['예약 시간'] + ' ≠ ' + c.time);
    if (hit['연락처'] !== c.tel)            issues.push(c.name + ' 연락처 불일치');
  }
  ok(!issues.some(x => x.includes('불일치') || x.includes('시트에 없음')), '이름·프로그램·시간·연락처가 시트와 전부 일치');

  /* 회차당 정원을 넘긴 예약이 있나 */
  const byslot = {};
  recs.forEach(r => { const k = r['참여 프로그램'] + ' ' + r['예약 시간']; byslot[k] = (byslot[k] || 0) + 1; });
  const cap = { '컬러링': 6, '바인더': 5 };
  const over = Object.entries(byslot).filter(([k, v]) => v > cap[k.split(' ')[0]]);
  ok(over.length === 0, '정원 초과 회차 없음' + (over.length ? ' — ' + JSON.stringify(over) : ''));
  await p0.close();

  /* 현장 체크인 */
  log('\n══════ 현장 체크인 ══════');
  const st = await ctx.newPage(); hook(st, 'staff');
  await st.goto(BASE + '/staff.html?k=' + KEY + '&staff=김운영', { waitUntil: 'networkidle' });
  await st.locator('.tabs button[data-p="check"]').click();
  await st.waitForTimeout(1200);
  const attended = [], noshow = [];
  for (const c of booked) {
    const sel = st.locator('#checkSlot');
    if (await sel.count()) { await sel.selectOption({ label: c.slot }).catch(() => {}); await st.waitForTimeout(900); }
    const card = st.locator('#roster .person[data-name]', { hasText: c.name }).first();
    if (!(await card.count())) { noted.push(c.name + ' 이 체크인 명단에 안 보임 (' + c.slot + ')'); continue; }
    const isNo = chance(0.2);
    await card.locator('button[data-st="' + (isNo ? '노쇼' : '참석') + '"]').click();
    await st.waitForTimeout(800);
    if (isNo) { noshow.push(c); continue; }
    attended.push(c);
    if (c.design) {
      const d = card.locator('button[data-design="' + c.design + '"]');
      if (await d.count()) { await d.click(); await st.waitForTimeout(700); }
    }
  }
  log('  참석 ' + attended.length + '명 / 노쇼 ' + noshow.length + '명');
  ok(attended.length + noshow.length === booked.length, '예약자 전원이 체크인 화면에 떴다');

  /* 판매 */
  log('\n══════ 판매 ══════');
  await st.locator('.tabs button[data-p="sale"]').click();
  await st.waitForTimeout(500);
  let expected = 0;
  const PRICE = { '바인더 체험': 30000, '바인더 완성품': 20000, '스티커': 2500 };
  for (const c of attended) {
    if (c.program === '바인더') {                    // 바인더 체험자는 체험료를 낸다
      await st.locator('.prod-main[data-item="바인더 체험"]').click(); await st.waitForTimeout(250);
      await st.locator('.pays button[data-pay="' + pick(['현금','카드','계좌']) + '"]').click();
      await st.waitForTimeout(900); expected += PRICE['바인더 체험'];
    }
    if (chance(0.4)) {                               // 스티커를 사기도 한다
      await st.locator('.prod-main[data-item="스티커"]').click(); await st.waitForTimeout(250);
      await st.locator('.pays button[data-pay="' + pick(['현금','카드']) + '"]').click();
      await st.waitForTimeout(900); expected += PRICE['스티커'];
    }
    if (chance(0.25)) {                              // 완성품을 사기도 한다
      await st.locator('.prod-main[data-item="바인더 완성품"]').click(); await st.waitForTimeout(250);
      await st.locator('.pays button[data-pay="카드"]').click();
      await st.waitForTimeout(900); expected += PRICE['바인더 완성품'];
    }
  }
  const shown = (await st.locator('#rev').textContent()).replace(/[^0-9]/g, '');
  ok(Number(shown) === expected, '운영 화면 매출 ' + Number(shown).toLocaleString() +
     '원 = 내가 누른 합계 ' + expected.toLocaleString() + '원');

  /* 방문 카운터 */
  await st.locator('.tabs button[data-p="visit"]').click();
  await st.waitForTimeout(500);
  let visits = 0;
  for (let i = 0; i < 6; i++) {
    const n = pick([1, 1, 2, 3]);
    const btn = n === 1 ? st.locator('#visitBtn') : st.locator('.visit-row button[data-co="' + n + '"]');
    if (!(await btn.count())) { noted.push('방문 +' + n + ' 버튼을 못 찾음'); break; }
    await btn.click(); await st.waitForTimeout(700); visits += n;
  }
  const vShown = (await st.locator('#visitNum').textContent()).replace(/[^0-9]/g, '');
  ok(Number(vShown) === visits, '방문 인원 ' + vShown + '명 = 누른 합계 ' + visits + '명');
  await st.close();

  /* 설문 · 후기 */
  log('\n══════ 설문 · 후기 ══════');
  let sv = 0;
  for (let i = 0; i < attended.length; i++) {
    const c = attended[i];
    const type = c.program === '바인더' ? 'binder' : 'coloring';
    if (await survey(ctx, type, c, i + 1)) sv++;
  }
  ok(sv === attended.length, '참석자 설문 ' + sv + '/' + attended.length + '건 제출 완료');

  let sns = 0;
  for (let i = 0; i < attended.length; i++) {
    if (!chance(0.5)) continue;
    if (await survey(ctx, 'sns', attended[i], 'S' + (i + 1))) sns++;
  }
  log('  SNS 후기 ' + sns + '건');

  /* 화면의 '제출되었습니다' 는 믿지 않는다. 실제로 시트에 남은 행을 센다.
     2026-09-19 현장에서 화면은 전부 성공이었는데 시트는 0건이었다. */
  const svPage = await ctx.newPage();
  await svPage.goto(BASE + '/survey.html', { waitUntil: 'domcontentloaded' });
  /* 설문 한 건이 시트에 여러 줄로 남는다 — 주소 길이 한계 때문에 문항을 나눠 보내고,
     각 덩이를 그 자체로 완결된 줄로 적기 때문이다. 둘째 줄부터는 이름 뒤에
     '(이어짐 2/3)' 이 붙으므로, 사람 수는 그 표시가 없는 줄만 센다. */
  const peopleIn = async tab => {
    const r = await svPage.evaluate(u => fetch(u).then(x => x.json()).catch(() => null),
                                    BASE + '/_dump?tab=' + encodeURIComponent(tab));
    if (!r || r.length < 2) return 0;              // 탭은 첫 응답 때 생기고 1행은 헤더다
    const i = r[0].indexOf('이름');
    return r.slice(1).filter(x => !/\(이어짐 \d+\/\d+\)\s*$/.test(String(x[i]))).length;
  };
  const inSheet = (await peopleIn('설문_컬러링체험')) + (await peopleIn('설문_바인더체험'));
  const snsInSheet = await peopleIn('설문_SNS후기');
  await svPage.close();
  ok(inSheet === sv, '시트에 실제로 저장된 설문 ' + inSheet + '건 = 제출한 ' + sv + '건');
  ok(snsInSheet === sns, '시트에 실제로 저장된 SNS 후기 ' + snsInSheet + '건 = 제출한 ' + sns + '건');

  /* 집계 화면 */
  log('\n══════ 집계 화면 대조 ══════');
  const rp = await ctx.newPage(); hook(rp, 'report');
  await rp.goto(BASE + '/report.html?k=' + KEY, { waitUntil: 'networkidle' });
  await rp.waitForTimeout(2500);
  ok(!(await rp.locator('#err').isVisible()), '집계 화면에 오류 배너 없음');
  const rev = (await rp.locator('#hRev').textContent().catch(() => '0')).replace(/[^0-9]/g, '');
  ok(Number(rev) === expected, '집계 매출 ' + Number(rev).toLocaleString() + '원 = 판매 합계 ' + expected.toLocaleString() + '원');
  const ppl = (await rp.locator('#hPeople').textContent().catch(() => '0')).replace(/[^0-9]/g, '');
  ok(Number(ppl) === attended.length, '집계 체험 인원 ' + ppl + '명 = 참석 ' + attended.length + '명');
  const vis = (await rp.locator('#hVisit').textContent().catch(() => '')).replace(/[^0-9]/g, '');
  ok(Number(vis) === visits, '집계 방문 인원 ' + vis + '명 = 카운터 ' + visits + '명');
  await rp.close();

  /* 재고 차감 */
  log('\n══════ 재고 ══════');
  const sp = await ctx.newPage(); hook(sp, 'stock');
  await sp.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await sp.evaluate(() => switchTab('status'));
  await sp.waitForTimeout(2500);
  const stockTxt = await sp.locator('#stockList').textContent();
  log('  ' + stockTxt.replace(/\s+/g, ' ').trim());
  ok(!/NaN|undefined/.test(stockTxt), '재고 표시에 NaN·undefined 없음');
  await sp.close();

  log('\n══════ 결과 ══════');
  if (noted.length) { log('  참고:'); noted.forEach(x => log('   · ' + x)); }
  if (issues.length) { log('  확인 필요 ' + issues.length + '건:'); issues.forEach(x => log('   ✗ ' + x)); process.exitCode = 1; }
  else log('  오류 없음');
  await b.close();
})();
