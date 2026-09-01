/**
 * 헬로미추 현장 데이터 자동수집 — 통합 백엔드
 * ─────────────────────────────────────────────────────────────
 * 2026.9.19 학산마당극 놀래 파일럿사업 2차 / 결과보고서 자동 집계용.
 *
 * 이 파일 하나가 다음을 전부 담당합니다.
 *   읽기  action=slots  (기본) — 기존 index.html 이 쓰던 응답 형태를 그대로 유지
 *         action=report        — 결과보고서 항목별 집계 (report.html)
 *         action=roster        — 회차별 예약자 명단 (staff.html 체크인)
 *   쓰기  action=sale | checkin | memo | stock  (staff.html)
 *
 * ⚠ 설치 후 반드시 [배포] → [배포 관리] → 연필 → 버전: 새 버전 → [배포] 까지 하세요.
 *    저장만 하면 편집기에서만 동작하고 실서비스 URL 에는 반영되지 않습니다.
 *
 * ⚠ 파라미터 이름으로 c 를 쓰지 마세요. 구글 인프라 예약어라서 스크립트에
 *    도달하기 전에 HTTP 400 이 납니다. (수량은 co, 콜백은 callback/cb 를 씁니다)
 */

var FIELD = {
  /* staff.html 접근키. staff.html?k=<이 값> 으로 열어야 쓰기가 허용됩니다.
     행사 전에 반드시 바꾸세요. */
  STAFF_KEY: 'michu919',

  TAB_SALE:    '판매',
  TAB_CHECKIN: '체크인',
  TAB_MEMO:    '관찰메모',
  TAB_STOCK:   '재고',

  /* 헤더 순서 = appendRow 순서. 둘 중 하나만 고치면 데이터가 옆 칸으로 밀립니다. */
  HEAD_SALE:    ['시각', '상품', '단가', '수량', '금액', '결제수단', '회차', '담당자', '취소여부'],
  HEAD_CHECKIN: ['시각', '회차', '프로그램', '예약자', '상태', '도안', '완성여부'],
  HEAD_MEMO:    ['시각', '태그', '회차', '내용'],
  HEAD_STOCK:   ['품목', '초기수량', '차감', '보정', '잔여'],

  /* 판매 상품 — key 는 재고 탭 품목명과 동일해야 합니다 */
  PRODUCTS: [
    { key: '바인더 체험',   price: 20000 },
    { key: '바인더 완성품', price: 30000 },
    { key: '스티커',       price: 2000  },
    { key: '액자',         price: 0     }   // SNS 후기 증정 (매출 0, 재고만 차감)
  ],

  /* 재고 9종 — 도안 5종 + 굿즈 4종. 키는 기존 sheetStock / goods 키를 그대로 씁니다. */
  STOCK_ITEMS: [
    { key: '01 소서노',     total: 12,  group: 'sheet' },
    { key: '02 문학산성',   total: 12,  group: 'sheet' },
    { key: '03 갯벌',       total: 12,  group: 'sheet' },
    { key: '04 수봉폭포',   total: 12,  group: 'sheet' },
    { key: '05 수봉도서관', total: 12,  group: 'sheet' },
    { key: '바인더 체험',   total: 40,  group: 'goods' },
    { key: '바인더 완성품', total: 50,  group: 'goods' },
    { key: '스티커',       total: 100, group: 'goods' },
    { key: '액자',         total: 28,  group: 'goods' }
  ],

  /* 무료 프로그램 — 전환율 분모가 됩니다 */
  FREE_PROGRAMS: ['컬러링'],

  /* 결과보고서 목표치 (= 달성률 분모) */
  TARGETS: {
    coloring:      60,        // 컬러링 체험 인원 (무료)
    binder:        50,        // 바인더 체험 인원
    binderProduct: 50,        // 바인더 완성품 판매
    sticker:      100,        // 데코 스티커 판매
    revenue:  2700000,        // 총 매출
    survey:        60,        // 설문 응답
    sns:           28         // SNS 후기 / 액자 증정
  },

  PAY_METHODS: ['현금', '카드', '계좌'],
  MEMO_TAGS:   ['미완성', '대기발생', '문의많음'],
  DESIGNS:     ['01 소서노', '02 문학산성', '03 갯벌', '04 수봉폭포', '05 수봉도서관']
};

/* ══════════════════════════════════════════════════════════════
   1. 진입점
   ══════════════════════════════════════════════════════════════ */
function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var action = String(p.action || 'slots');
  var out;

  try {
    switch (action) {
      case 'slots':   out = buildSlotsPayload_();       break;
      case 'report':  out = buildReport_();             break;
      case 'roster':  out = buildRoster_(p.slot);       break;
      case 'sale':    out = actSale_(p);                break;
      case 'checkin': out = actCheckin_(p);             break;
      case 'memo':    out = actMemo_(p);                break;
      case 'stock':   out = actStock_(p);               break;
      default:        out = { ok: false, error: '알 수 없는 action: ' + action };
    }
    if (out && out.ok === undefined) out.ok = true;
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return reply_(out, p);
}

/**
 * GitHub Pages → Apps Script 는 fetch() POST 가 CORS 로 막힌다.
 * 그래서 쓰기까지 전부 GET + JSONP 로 처리한다.
 * callback(또는 cb) 파라미터가 있으면 JS 로, 없으면 순수 JSON 으로 응답.
 */
function reply_(obj, p) {
  var json = JSON.stringify(obj);
  var cb = p.callback || p.cb || '';
  if (cb && /^[A-Za-z_$][A-Za-z0-9_$]{0,60}$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');')
                         .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
                       .setMimeType(ContentService.MimeType.JSON);
}

function requireKey_(p) {
  if (!FIELD.STAFF_KEY) return;
  if (String(p.k || '') !== FIELD.STAFF_KEY) {
    throw new Error('접근키가 올바르지 않습니다.');
  }
}

/* ══════════════════════════════════════════════════════════════
   2. 시트 준비 — 헤더 생성은 이 함수 하나로만
   ══════════════════════════════════════════════════════════════ */
function setupFieldSheets() {
  ensureSheet_(FIELD.TAB_SALE,    FIELD.HEAD_SALE);
  ensureSheet_(FIELD.TAB_CHECKIN, FIELD.HEAD_CHECKIN);
  ensureSheet_(FIELD.TAB_MEMO,    FIELD.HEAD_MEMO);
  ensureStockSheet_();
  SpreadsheetApp.getActiveSpreadsheet().toast('현장 데이터 탭 4종 준비 완료', '헬로미추', 5);
}

function ensureSheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  var need = false;
  if (sh.getLastRow() === 0) {
    need = true;
  } else {
    var cur = sh.getRange(1, 1, 1, header.length).getValues()[0];
    for (var i = 0; i < header.length; i++) {
      if (String(cur[i]).trim() !== header[i]) { need = true; break; }
    }
  }
  if (need) {
    sh.getRange(1, 1, 1, header.length).setValues([header])
      .setFontWeight('bold').setBackground('#efe9e0');
    sh.setFrozenRows(1);
  }
  return sh;
}

function ensureStockSheet_() {
  var sh = ensureSheet_(FIELD.TAB_STOCK, FIELD.HEAD_STOCK);
  var have = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { have[String(r[0]).trim()] = true; });
  }
  FIELD.STOCK_ITEMS.forEach(function (it) {
    if (!have[it.key]) sh.appendRow([it.key, it.total, 0, 0, it.total]);
  });
  return sh;
}

/* ══════════════════════════════════════════════════════════════
   3. 재고
   ══════════════════════════════════════════════════════════════ */
/** 잔여 = 초기수량 - 차감 + 보정. 값으로 써두어 읽기를 단순하게 유지한다. */
function stockRows_() {
  var sh = ensureStockSheet_();
  if (sh.getLastRow() < 2) return { sheet: sh, map: {}, order: [] };
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  var map = {}, order = [];
  vals.forEach(function (r, i) {
    var key = String(r[0]).trim();
    if (!key) return;
    map[key] = {
      row: i + 2,
      total: Number(r[1]) || 0,
      used:  Number(r[2]) || 0,
      adj:   Number(r[3]) || 0
    };
    order.push(key);
  });
  return { sheet: sh, map: map, order: order };
}

function stockRemain_(rec) {
  return Math.max(0, rec.total - rec.used + rec.adj);
}

/** 재고 차감(delta>0) 또는 복구(delta<0) */
function bumpStock_(key, delta) {
  if (!key || !delta) return;
  var st = stockRows_();
  var rec = st.map[key];
  if (!rec) {
    var meta = FIELD.STOCK_ITEMS.filter(function (x) { return x.key === key; })[0];
    var total = meta ? meta.total : 0;
    st.sheet.appendRow([key, total, Math.max(0, delta), 0, Math.max(0, total - delta)]);
    return;
  }
  var used = Math.max(0, rec.used + delta);
  st.sheet.getRange(rec.row, 3).setValue(used);
  st.sheet.getRange(rec.row, 5).setValue(Math.max(0, rec.total - used + rec.adj));
}

function getStockPayload_() {
  var st = stockRows_();
  var sheetStock = [], goods = [], all = [];
  FIELD.STOCK_ITEMS.forEach(function (it) {
    var rec = st.map[it.key] || { total: it.total, used: 0, adj: 0 };
    var row = { key: it.key, remain: stockRemain_(rec), total: rec.total, used: rec.used };
    all.push(row);
    if (it.group === 'sheet') sheetStock.push({ key: row.key, remain: row.remain });
    else                      goods.push({ key: row.key, remain: row.remain });
  });
  return { sheetStock: sheetStock, goods: goods, all: all };
}

/* ══════════════════════════════════════════════════════════════
   4. 읽기 — action=slots (index.html 기존 응답 형태 유지)
   ══════════════════════════════════════════════════════════════ */
function buildSlotsPayload_() {
  var stock = getStockPayload_();
  var payload = {
    slots:          [],
    sheetStock:     stock.sheetStock,
    goods:          stock.goods,
    surveyProgress: []
  };
  // slot-capacity.gs 가 같은 프로젝트에 있으면 그대로 재사용한다
  if (typeof getSlotAvailability === 'function') {
    try { payload.slots = getSlotAvailability(); } catch (err) {}
  }
  if (typeof getSurveyProgress === 'function') {
    try { payload.surveyProgress = getSurveyProgress(); } catch (err) {}
  }
  return payload;
}

/* ══════════════════════════════════════════════════════════════
   5. 쓰기
   ══════════════════════════════════════════════════════════════ */
/**
 * 판매 기록.
 *   action=sale&item=스티커&co=2&pay=현금&slot=컬러링 13:30|홍길동&staff=이름&k=키
 *   action=sale&undo=1&k=키      ← 직전(미취소) 판매 1건 취소 + 재고 복구
 *
 * 수량 파라미터는 co 입니다. c 는 구글 예약어라 400 이 납니다.
 */
function actSale_(p) {
  requireKey_(p);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = ensureSheet_(FIELD.TAB_SALE, FIELD.HEAD_SALE);

    if (String(p.undo || '') === '1') return undoSale_(sh);

    var item = String(p.item || '').trim();
    var meta = FIELD.PRODUCTS.filter(function (x) { return x.key === item; })[0];
    if (!meta) throw new Error('알 수 없는 상품: ' + item);

    var qty = Math.max(1, Math.min(50, parseInt(p.co || p.qty || '1', 10) || 1));
    var pay = String(p.pay || '').trim();
    if (meta.price > 0 && FIELD.PAY_METHODS.indexOf(pay) === -1) {
      throw new Error('결제수단을 선택해 주세요.');
    }
    var amount = meta.price * qty;

    // 헤더 순서와 1:1 — 시각 상품 단가 수량 금액 결제수단 회차 담당자 취소여부
    sh.appendRow([
      nowStamp_(), item, meta.price, qty, amount,
      pay, String(p.slot || '').trim(), String(p.staff || '').trim(), ''
    ]);
    bumpStock_(item, qty);

    return { ok: true, item: item, qty: qty, amount: amount, revenue: revenueTotal_() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Undo — 행을 지우지 않고 취소여부에 '취소' 를 남기고 재고를 되돌린다.
 * 행을 삭제하면 정산 대사 때 "왜 비었는지" 를 설명할 수 없고,
 * 운영자 2명이 동시에 기록하는 중이면 엉뚱한 행이 지워질 수 있다.
 */
function undoSale_(sh) {
  var last = sh.getLastRow();
  for (var r = last; r >= 2; r--) {
    var row = sh.getRange(r, 1, 1, FIELD.HEAD_SALE.length).getValues()[0];
    if (String(row[8]).trim()) continue;              // 이미 취소된 행은 건너뛴다
    sh.getRange(r, 9).setValue('취소');
    sh.getRange(r, 1, 1, FIELD.HEAD_SALE.length).setBackground('#fdecea');
    bumpStock_(String(row[1]).trim(), -(Number(row[3]) || 0));
    return {
      ok: true, undone: true,
      item: String(row[1]), qty: Number(row[3]) || 0,
      revenue: revenueTotal_()
    };
  }
  return { ok: false, error: '취소할 판매 기록이 없습니다.' };
}

/**
 * 체크인 / 노쇼.
 *   action=checkin&slot=컬러링 13:30&name=홍길동&status=참석&design=02 문학산성&done=완성&k=키
 * 같은 회차·같은 이름이면 새 행을 쌓지 않고 기존 행을 갱신한다(토글 대비).
 */
function actCheckin_(p) {
  requireKey_(p);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh   = ensureSheet_(FIELD.TAB_CHECKIN, FIELD.HEAD_CHECKIN);
    var slot = String(p.slot || '').trim();
    var name = String(p.name || '').trim();
    var status = String(p.status || '참석').trim();
    var design = String(p.design || '').trim();
    var done   = String(p.done || '').trim();
    if (!slot) throw new Error('회차가 비어 있습니다.');

    var parsed  = parseSlot_(slot);
    var program = parsed.program;

    var found = 0, prevStatus = '', prevDesign = '';
    if (sh.getLastRow() > 1) {
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, FIELD.HEAD_CHECKIN.length).getValues();
      for (var i = vals.length - 1; i >= 0; i--) {
        if (String(vals[i][1]).trim() === slot && String(vals[i][3]).trim() === name) {
          found = i + 2;
          prevStatus = String(vals[i][4]).trim();
          prevDesign = String(vals[i][5]).trim();
          break;
        }
      }
    }

    // 헤더 순서와 1:1 — 시각 회차 프로그램 예약자 상태 도안 완성여부
    var row = [nowStamp_(), slot, program, name, status, design, done];
    if (found) sh.getRange(found, 1, 1, row.length).setValues([row]);
    else       sh.appendRow(row);

    // 도안 재고는 '참석' 일 때만 차감하고, 되돌리면 복구한다
    var wasAttend = (prevStatus === '참석');
    var nowAttend = (status === '참석');
    if (nowAttend && design && (!wasAttend || prevDesign !== design)) {
      if (wasAttend && prevDesign) bumpStock_(prevDesign, -1);
      bumpStock_(design, 1);
    } else if (!nowAttend && wasAttend && prevDesign) {
      bumpStock_(prevDesign, -1);
    }

    return { ok: true, slot: slot, name: name, status: status };
  } finally {
    lock.releaseLock();
  }
}

/** 관찰 태그 — action=memo&tag=대기발생&slot=컬러링 14:00&note=내용&k=키 */
function actMemo_(p) {
  requireKey_(p);
  var sh = ensureSheet_(FIELD.TAB_MEMO, FIELD.HEAD_MEMO);
  var tag = String(p.tag || '').trim();
  if (!tag) throw new Error('태그가 비어 있습니다.');
  // 헤더 순서와 1:1 — 시각 태그 회차 내용
  sh.appendRow([nowStamp_(), tag, String(p.slot || '').trim(), String(p.note || '').trim()]);
  return { ok: true, tag: tag };
}

/** 재고 수동 보정 — action=stock&item=스티커&val=73&k=키 (잔여를 val 로 맞춘다) */
function actStock_(p) {
  requireKey_(p);
  var item = String(p.item || '').trim();
  var val  = parseInt(p.val, 10);
  if (isNaN(val) || val < 0) throw new Error('보정값이 올바르지 않습니다.');

  var st  = stockRows_();
  var rec = st.map[item];
  if (!rec) throw new Error('재고 품목을 찾을 수 없습니다: ' + item);

  // 잔여 = 초기 - 차감 + 보정  →  보정 = 목표잔여 - 초기 + 차감
  var adj = val - rec.total + rec.used;
  st.sheet.getRange(rec.row, 4).setValue(adj);
  st.sheet.getRange(rec.row, 5).setValue(val);
  return { ok: true, item: item, remain: val };
}

/* ══════════════════════════════════════════════════════════════
   6. 회차별 예약자 명단
   ══════════════════════════════════════════════════════════════ */
function buildRoster_(slot) {
  var out = { slot: String(slot || ''), people: [], designs: FIELD.DESIGNS };
  var parsed = parseSlot_(out.slot);
  if (!parsed.program || !parsed.time) return out;

  var existing = {};   // 회차 기존 체크인 상태
  var csh = ensureSheet_(FIELD.TAB_CHECKIN, FIELD.HEAD_CHECKIN);
  if (csh.getLastRow() > 1) {
    csh.getRange(2, 1, csh.getLastRow() - 1, FIELD.HEAD_CHECKIN.length).getValues()
      .forEach(function (r) {
        if (String(r[1]).trim() !== out.slot) return;
        existing[String(r[3]).trim()] = { status: String(r[4]).trim(), design: String(r[5]).trim(), done: String(r[6]).trim() };
      });
  }

  // 예약 응답 시트에서 이 회차 신청자를 뽑는다 (slot-capacity.gs 의 헬퍼 재사용)
  var names = [];
  try {
    var sh   = getSheet_();
    var cols = getColumns_(sh);
    if (sh.getLastRow() > 1) {
      var head  = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
      var nameCol = 0;
      ['이름', '성함', '성명'].forEach(function (label) {
        if (nameCol) return;
        for (var i = 0; i < head.length; i++) if (head[i].indexOf(label) !== -1) { nameCol = i + 1; break; }
      });
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
      vals.forEach(function (r, i) {
        var program = normalizeProgram_(r[cols.program - 1]);
        var time    = normalizeTime_(r[cols.time - 1]);
        var status  = String(r[cols.status - 1] || '');
        if (program !== parsed.program || time !== parsed.time) return;
        if (CONFIG.EXCLUDE_STATUS.some(function (x) { return status.indexOf(x) !== -1; })) return;
        var nm = nameCol ? String(r[nameCol - 1]).trim() : '';
        names.push(nm || ('예약 ' + (i + 2) + '행'));
      });
    }
  } catch (err) {
    out.warn = String((err && err.message) || err);
  }

  // 예약 없이 현장에서 체크인된 사람도 명단에 남긴다
  Object.keys(existing).forEach(function (nm) {
    if (nm && names.indexOf(nm) === -1) names.push(nm);
  });

  out.people = names.map(function (nm) {
    var s = existing[nm] || {};
    return { name: nm, status: s.status || '', design: s.design || '', done: s.done || '' };
  });
  return out;
}

/* ══════════════════════════════════════════════════════════════
   7. 집계 — 결과보고서 항목 그대로. 계산은 전부 서버에서.
   ══════════════════════════════════════════════════════════════ */
function buildReport_() {
  var sales   = readSales_();
  var checkin = readCheckin_();
  var memo    = readMemo_();
  var stock   = getStockPayload_();

  /* ── 판매 · 매출 ── */
  var byItem = {}, byPay = {}, revenue = 0, cancelled = 0;
  FIELD.PRODUCTS.forEach(function (x) { byItem[x.key] = { qty: 0, amount: 0, price: x.price }; });
  FIELD.PAY_METHODS.forEach(function (m) { byPay[m] = 0; });

  sales.forEach(function (s) {
    if (s.cancelled) { cancelled++; return; }
    if (!byItem[s.item]) byItem[s.item] = { qty: 0, amount: 0, price: s.price };
    byItem[s.item].qty    += s.qty;
    byItem[s.item].amount += s.amount;
    revenue += s.amount;
    if (s.pay) byPay[s.pay] = (byPay[s.pay] || 0) + s.amount;
  });

  /* ── 체크인 · 노쇼 · 도안 · 완성여부 ── */
  var attend = {}, noshow = {}, designs = {}, unfinished = 0;
  FIELD.DESIGNS.forEach(function (d) { designs[d] = 0; });

  checkin.forEach(function (r) {
    if (r.status === '참석') {
      attend[r.program] = (attend[r.program] || 0) + 1;
      if (r.design) designs[r.design] = (designs[r.design] || 0) + 1;
      if (r.done && r.done !== '완성') unfinished++;
    } else if (r.status === '노쇼') {
      noshow[r.program] = (noshow[r.program] || 0) + 1;
    }
  });

  /* ── 관찰 태그 ── */
  var tags = {};
  FIELD.MEMO_TAGS.forEach(function (t) { tags[t] = 0; });
  memo.forEach(function (m) { tags[m.tag] = (tags[m.tag] || 0) + 1; });

  /* ── 무료 체험자 → 유료 전환 ──
     판매 행의 회차 칸에 "컬러링 13:30|홍길동" 처럼 구매자를 붙여두면 1:1 로,
     이름 없이 "컬러링 13:30" 만 있으면 회차 단위로 잡힌다. */
  var buyerKeys = {}, buyerNames = {}, buyerSlots = {};
  sales.forEach(function (s) {
    if (s.cancelled || s.price <= 0 || !s.slot) return;
    var ps = parseSlot_(s.slot);
    if (ps.name) {
      buyerKeys[ps.program + ' ' + ps.time + '|' + ps.name] = true;
      buyerNames[ps.name] = true;
    }
    buyerSlots[ps.program + ' ' + ps.time] = true;
  });

  var freeAttend = 0, converted = 0, convertedSlots = {};
  checkin.forEach(function (r) {
    if (r.status !== '참석') return;
    if (FIELD.FREE_PROGRAMS.indexOf(r.program) === -1) return;
    freeAttend++;
    var ps = parseSlot_(r.slot);
    var slotKey = ps.program + ' ' + ps.time;
    if (buyerKeys[slotKey + '|' + r.name] || (r.name && buyerNames[r.name])) {
      converted++; convertedSlots[slotKey] = true;
    } else if (buyerSlots[slotKey]) {
      convertedSlots[slotKey] = true;
    }
  });

  /* ── 설문 / SNS ── */
  var survey = countFormRows_(typeof CONFIG !== 'undefined' ? CONFIG.SURVEY_SHEET_NAME : '');
  var sns    = countFormRows_(typeof CONFIG !== 'undefined' ? CONFIG.SNS_SHEET_NAME    : '');
  var framesGiven = (byItem['액자'] && byItem['액자'].qty) || 0;
  if (!sns) sns = framesGiven;   // 후기 시트가 아직 없으면 액자 증정 건수로 대신한다

  /* 되돌릴 수 있는 직전 판매 — staff.html 이 폰을 새로고침해도 Undo 를 살려두기 위함 */
  var lastSale = null;
  for (var li = sales.length - 1; li >= 0; li--) {
    if (!sales[li].cancelled) {
      lastSale = { item: sales[li].item, qty: sales[li].qty,
                   amount: sales[li].amount, pay: sales[li].pay, stamp: String(sales[li].stamp) };
      break;
    }
  }

  var T = FIELD.TARGETS;
  return {
    generatedAt: nowStamp_(),
    lastSale: lastSale,
    targets: T,
    attendance: {
      coloring:      attend['컬러링'] || 0,
      binder:        attend['바인더'] || 0,
      noshowColoring: noshow['컬러링'] || 0,
      noshowBinder:   noshow['바인더'] || 0,
      total: (attend['컬러링'] || 0) + (attend['바인더'] || 0)
    },
    sales: {
      byItem:    byItem,
      byPay:     byPay,
      revenue:   revenue,
      cancelled: cancelled,
      count:     sales.filter(function (s) { return !s.cancelled; }).length
    },
    designs:    designs,
    unfinished: unfinished,
    tags:       tags,
    survey:     { count: survey, sns: sns, frames: framesGiven },
    conversion: {
      freeAttend:  freeAttend,
      converted:   converted,
      rate:        freeAttend ? Math.round(converted / freeAttend * 1000) / 10 : 0,
      slotsWithSale: Object.keys(convertedSlots).length
    },
    stock: stock.all,
    rate: {
      coloring:      pct_(attend['컬러링'] || 0, T.coloring),
      binder:        pct_(attend['바인더'] || 0, T.binder),
      binderProduct: pct_((byItem['바인더 완성품'] || {}).qty || 0, T.binderProduct),
      sticker:       pct_((byItem['스티커'] || {}).qty || 0, T.sticker),
      revenue:       pct_(revenue, T.revenue),
      survey:        pct_(survey, T.survey),
      sns:           pct_(sns, T.sns)
    }
  };
}

function pct_(v, target) {
  if (!target) return 0;
  return Math.round(v / target * 1000) / 10;
}

function readSales_() {
  var sh = ensureSheet_(FIELD.TAB_SALE, FIELD.HEAD_SALE);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, FIELD.HEAD_SALE.length).getValues()
    .map(function (r) {
      return {
        stamp: r[0], item: String(r[1]).trim(),
        price: Number(r[2]) || 0, qty: Number(r[3]) || 0, amount: Number(r[4]) || 0,
        pay: String(r[5]).trim(), slot: String(r[6]).trim(), staff: String(r[7]).trim(),
        cancelled: !!String(r[8]).trim()
      };
    })
    .filter(function (s) { return !!s.item; });
}

function readCheckin_() {
  var sh = ensureSheet_(FIELD.TAB_CHECKIN, FIELD.HEAD_CHECKIN);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, FIELD.HEAD_CHECKIN.length).getValues()
    .map(function (r) {
      return {
        stamp: r[0], slot: String(r[1]).trim(), program: String(r[2]).trim(),
        name: String(r[3]).trim(), status: String(r[4]).trim(),
        design: String(r[5]).trim(), done: String(r[6]).trim()
      };
    })
    .filter(function (r) { return !!r.slot; });
}

function readMemo_() {
  var sh = ensureSheet_(FIELD.TAB_MEMO, FIELD.HEAD_MEMO);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, FIELD.HEAD_MEMO.length).getValues()
    .map(function (r) {
      return { stamp: r[0], tag: String(r[1]).trim(), slot: String(r[2]).trim(), note: String(r[3]).trim() };
    })
    .filter(function (m) { return !!m.tag; });
}

/** 폼 응답 시트의 데이터 행 수 */
function countFormRows_(name) {
  if (!name) return 0;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return 0;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
           .filter(function (r) { return String(r[0]).trim() !== ''; }).length;
}

function revenueTotal_() {
  return readSales_().reduce(function (a, s) { return a + (s.cancelled ? 0 : s.amount); }, 0);
}

/* ══════════════════════════════════════════════════════════════
   8. 유틸
   ══════════════════════════════════════════════════════════════ */
/** "컬러링 13:30|홍길동" → { program, time, name } */
function parseSlot_(v) {
  var s = String(v || '').trim();
  var name = '';
  var bar = s.indexOf('|');
  if (bar !== -1) { name = s.slice(bar + 1).trim(); s = s.slice(0, bar).trim(); }
  var m = s.match(/(\d{1,2}:\d{2})/);
  var time = m ? m[1] : '';
  var program = s.replace(/(\d{1,2}:\d{2})/, '').trim();
  return { program: program, time: time, name: name };
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

/* ══════════════════════════════════════════════════════════════
   9. 점검용 — 편집기에서 직접 실행
   ══════════════════════════════════════════════════════════════ */
function debugReport() {
  var r = buildReport_();
  Logger.log('매출 %s원 / 컬러링 %s명 / 바인더 %s명',
             r.sales.revenue, r.attendance.coloring, r.attendance.binder);
  Logger.log('전환 %s / %s명 (%s%%)', r.conversion.converted, r.conversion.freeAttend, r.conversion.rate);
  Logger.log(JSON.stringify(r, null, 2));
}
