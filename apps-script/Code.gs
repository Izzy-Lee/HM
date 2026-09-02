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
    { key: '액자',         price: 0     },  // SNS 후기 증정 (매출 0, 재고만 차감)
    /* 유료 구매 후 설문을 쓰면 드리는 스티커.
       [발주자 확정] 증정분은 판매용 스티커와 같은 재고에서 나간다.
       집계만 판매분과 분리한다 — 증정이 '스티커 100개 판매' 실적에 섞이면 안 되기 때문. */
    { key: '스티커 증정',   price: 0, stock: '스티커' }
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
  DESIGNS:     ['01 소서노', '02 문학산성', '03 갯벌', '04 수봉폭포', '05 수봉도서관'],

  /* ── 설문 ──
     문항은 survey.html 이 들고 있고, 여기서는 어떤 설문이 있는지와
     어느 시트에 쌓을지만 정한다. 문항을 고쳐도 이 파일은 건드릴 필요가 없다. */
  SURVEYS: {
    coloring:   { name: '컬러링 체험',     tab: '설문_컬러링체험',   group: 'experience' },
    binder:     { name: '자개바인더 체험', tab: '설문_바인더체험',   group: 'experience' },
    binder_buy: { name: '자개바인더 구매', tab: '설문_바인더구매',   group: 'purchase'   },
    sticker:    { name: '데코스티커 구매', tab: '설문_스티커구매',   group: 'purchase'   },
    sns:        { name: 'SNS 후기 인증',   tab: '설문_SNS후기',      group: 'sns', gift: '액자' }
  },

  /* 캡처 이미지와 집계 백업을 담을 구글 드라이브 폴더.
     없으면 내 드라이브에 자동으로 만든다. */
  DRIVE_FOLDER: '헬로미추 2026-09-19 현장자료',
  DRIVE_IMAGE_SUBFOLDER: 'SNS 후기 캡처',

  /* 설문을 쓰면 스티커를 드리는 설문 종류.
     [발주자 확정] 유료 구매자에게만 준다. 무료 컬러링은 제외 — 이쪽 혜택은 SNS 후기 액자다.
     바꿔야 하면 여기에 'coloring' 을 넣으면 되지만, 확정된 운영 방침이므로 임의로 넣지 말 것. */
  GIFT_SURVEYS: ['binder', 'binder_buy', 'sticker', 'sns'],
  GIFT_ITEM: '스티커 증정',        // 기본 증정품. 설문별로 다르면 SURVEYS[t].gift 가 이긴다.

  /* 설문 앞뒤로 붙는 고정 컬럼. 나머지 문항 컬럼은 응답 키를 보고 자동으로 늘어난다. */
  SURVEY_HEAD: ['시각', '설문종류', '회차', '이름', '증정코드', '증정여부', '증정시각',
                '게시물 링크', '캡처 이미지']
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
      case 'survey':  out = actSurvey_(p);              break;
      case 'gift':    out = actGift_(p);                break;
      case 'book':    out = actBook_(p);                break;
      case 'img':     out = actImage_(p);               break;
      case 'snapshot':out = actSnapshot_(p);            break;
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
/** 상품이 어느 재고에서 나가는지. 지정이 없으면 상품명 그대로. */
function stockKeyOf_(item) {
  var meta = FIELD.PRODUCTS.filter(function (x) { return x.key === item; })[0];
  return (meta && meta.stock) ? meta.stock : item;
}

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
    bumpStock_(stockKeyOf_(item), qty);

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
    bumpStock_(stockKeyOf_(String(row[1]).trim()), -(Number(row[3]) || 0));
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
   5-1. 체험 예약
   ══════════════════════════════════════════════════════════════ */
/**
 * 예약 접수 — action=book&program=컬러링&time=13:30&name=홍길동&tel=010...&design=...&agree=1
 *
 * 구글 폼을 대체하되 **같은 응답 시트**에 쓴다. 그래야 정원 마감·예약 현황·
 * 회차별 명단이 지금 그대로 돌아가고, 폼을 병행해도 한 곳에 모인다.
 * 시트 헤더를 읽어 이름으로 맞춰 넣으므로, 폼이 어떤 컬럼을 갖고 있든 상관없다.
 *
 * 정원 검사는 잠금 안에서 한다. 구글 폼은 미리 열어둔 화면으로 제출하면
 * 초과 접수가 들어온 뒤 사후 취소되는 구조였는데, 여기서는 애초에 막는다.
 */
function actBook_(p) {
  var program = normalizeProgram_(String(p.program || '').trim());
  var time    = normalizeTime_(String(p.time || '').trim());
  var name    = String(p.name || '').trim();
  var tel     = String(p.tel || '').trim();
  var design  = String(p.design || '').trim();

  if (!program || !time) throw new Error('프로그램과 시간을 선택해 주세요.');
  if (!name)             throw new Error('이름을 입력해 주세요.');
  if (!tel)              throw new Error('연락처를 입력해 주세요.');
  if (String(p.agree || '') !== '1') throw new Error('개인정보 수집·이용에 동의해 주세요.');
  if (isSlotPast_(time)) throw new Error('이미 지난 시간대입니다.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh   = getSheet_();
    var cols = getColumns_(sh);

    // 정원 검사 — 잠금 안에서 세고 바로 쓴다
    var counts   = countBySlot_(sh, cols);
    var capacity = capacityOf_(program);
    var used     = counts[slotKey_(program, time)] || 0;
    if (used >= capacity) {
      throw new Error(program + ' ' + time + ' 회차는 방금 마감되었습니다. 다른 시간대를 선택해 주세요.');
    }

    // 같은 이름·연락처로 같은 회차를 두 번 넣는 것을 막는다 (버튼 두 번 누름 대비)
    if (bookedAlready_(sh, cols, program, time, name, tel)) {
      return { ok: true, duplicate: true, program: program, time: time,
               remain: Math.max(0, capacity - used) };
    }

    var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
                   .map(function (v) { return String(v).trim(); });

    /* 시트 헤더 이름으로 값을 맞춰 넣는다. 없는 항목은 헤더 끝에 컬럼을 만든다. */
    var want = [
      { names: ['타임스탬프', 'Timestamp'],            value: nowStamp_() },
      { names: [CONFIG.COL_PROGRAM, '프로그램'],        value: program },
      { names: [CONFIG.COL_TIME, '시간'],               value: time },
      { names: ['이름', '성함', '성명'],                 value: name },
      { names: ['연락처', '전화', '휴대폰', '핸드폰'],    value: tel }
    ];
    if (design) want.push({ names: ['도안', '희망 도안'], value: design });
    want.push({ names: ['접수경로'], value: '홈페이지' });

    var row = [];
    for (var i = 0; i < header.length; i++) row.push('');

    want.forEach(function (w) {
      var at = -1;
      for (var i = 0; i < header.length && at === -1; i++) {
        for (var j = 0; j < w.names.length; j++) {
          if (w.names[j] && header[i].indexOf(w.names[j]) !== -1) { at = i; break; }
        }
      }
      if (at === -1) {                       // 없으면 컬럼을 만든다
        header.push(w.names[0]);
        sh.getRange(1, header.length).setValue(w.names[0]).setFontWeight('bold');
        at = header.length - 1;
        row.push('');
      }
      row[at] = w.value;
    });

    while (row.length < header.length) row.push('');
    sh.appendRow(row);

    // 정원이 찼으면 폼 선택지도 정리해 둔다 (구글 폼을 병행하는 경우 대비)
    try { if (typeof syncFormChoices === 'function') syncFormChoices(); } catch (err) {}

    return {
      ok: true, program: program, time: time, name: name,
      remain: Math.max(0, capacity - used - 1), capacity: capacity
    };
  } finally {
    lock.releaseLock();
  }
}

/** 같은 사람이 같은 회차를 이미 잡아뒀는지 */
function bookedAlready_(sh, cols, program, time, name, tel) {
  if (sh.getLastRow() < 2) return false;
  var lastCol = sh.getLastColumn();
  var header  = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); });
  var find = function (names) {
    for (var i = 0; i < header.length; i++) {
      for (var j = 0; j < names.length; j++) {
        if (names[j] && header[i].indexOf(names[j]) !== -1) return i + 1;
      }
    }
    return 0;
  };
  var cName = find(['이름', '성함', '성명']);
  var cTel  = find(['연락처', '전화', '휴대폰', '핸드폰']);
  if (!cName && !cTel) return false;

  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getValues();
  var digits = function (v) { return String(v).replace(/[^0-9]/g, ''); };
  for (var r = 0; r < vals.length; r++) {
    if (normalizeProgram_(vals[r][cols.program - 1]) !== program) continue;
    if (normalizeTime_(vals[r][cols.time - 1]) !== time) continue;
    var status = String(vals[r][cols.status - 1] || '');
    if (CONFIG.EXCLUDE_STATUS.some(function (x) { return status.indexOf(x) !== -1; })) continue;
    var sameName = cName && String(vals[r][cName - 1]).trim() === name;
    var sameTel  = cTel  && digits(vals[r][cTel - 1]) === digits(tel) && digits(tel) !== '';
    if (sameName && (sameTel || !cTel)) return true;
    if (sameTel && !cName) return true;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════
   5-2. 설문
   ══════════════════════════════════════════════════════════════ */
/**
 * 설문 제출.
 *   action=survey&t=coloring&sid=abc123&i=0&n=3&d=<base64url 조각>&k=키
 *
 * 설문은 문항이 25개까지 가고 주관식도 있어서 한 번의 GET 에 다 담기지 않는다.
 * 그래서 응답 전체를 JSON → base64url 로 만든 뒤 조각내 보내고,
 * 여기서 다시 합친다. 마지막 조각이 도착했을 때만 시트에 쓴다.
 * 조각은 CacheService 에 최대 10분간 보관한다(설문 1건 작성 시간보다 넉넉하다).
 */
function actSurvey_(p) {
  var type = String(p.t || '').trim();
  var meta = FIELD.SURVEYS[type];
  if (!meta) throw new Error('알 수 없는 설문 종류: ' + type);

  var sid = String(p.sid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  var idx = parseInt(p.i, 10);
  var tot = parseInt(p.n, 10);
  var data = String(p.d || '');
  if (!sid || isNaN(idx) || isNaN(tot) || tot < 1) throw new Error('전송 정보가 올바르지 않습니다.');

  var cache = CacheService.getScriptCache();

  if (tot > 1) {
    cache.put('sv_' + sid + '_' + idx, data, 600);
    var have = [], missing = false;
    for (var i = 0; i < tot; i++) {
      var part = (i === idx) ? data : cache.get('sv_' + sid + '_' + i);
      if (part === null) { missing = true; break; }
      have.push(part);
    }
    if (missing) return { ok: true, received: idx + 1, of: tot, done: false };
    data = have.join('');
  }

  var answers;
  try {
    answers = JSON.parse(b64urlDecode_(data));
  } catch (err) {
    throw new Error('응답을 읽지 못했습니다. 다시 제출해 주세요.');
  }

  // 같은 sid 가 두 번 도착해도 한 번만 기록한다 (재전송·중복 탭 대비)
  var guard = 'svdone_' + sid;
  var prev = cache.get(guard);
  if (prev) return JSON.parse(prev);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var result;
  try {
    result = writeSurveyRow_(type, meta, answers, p);
  } finally {
    lock.releaseLock();
  }
  cache.put(guard, JSON.stringify(result), 600);
  for (var j = 0; j < tot; j++) cache.remove('sv_' + sid + '_' + j);
  return result;
}

/**
 * 설문 1건을 시트에 쓴다.
 * 헤더를 미리 고정하지 않고, 응답에 있는 문항 키를 보고 없으면 컬럼을 만든다.
 * 문항을 나중에 고쳐도 값이 옆 칸으로 밀리지 않는다.
 */
function writeSurveyRow_(type, meta, answers, p) {
  var sh = ensureSheet_(meta.tab, FIELD.SURVEY_HEAD);
  var lastCol = Math.max(sh.getLastColumn(), FIELD.SURVEY_HEAD.length);
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); });

  // 새로 등장한 문항은 헤더 끝에 컬럼을 만든다
  Object.keys(answers).forEach(function (k) {
    if (header.indexOf(k) === -1) {
      header.push(k);
      sh.getRange(1, header.length).setValue(k).setFontWeight('bold').setBackground('#efe9e0');
    }
  });

  var gift = FIELD.GIFT_SURVEYS.indexOf(type) !== -1;
  var giftItem = giftItemFor_(type);
  /* 코드는 설문 화면이 만들어 보낸다 — 네트워크가 끊겨도 완료 화면에 코드를 띄우기 위함.
     혹시 겹치면 여기서 새로 뽑아 돌려준다. */
  var code = '';
  if (gift) {
    var want = String(p.code || '').trim().toUpperCase();
    code = /^HM-[A-Z0-9]{4}$/.test(want) && !giftCodeTaken_(want) ? want : giftCode_();
  }

  var fixed = {
    '시각':        nowStamp_(),
    '설문종류':    meta.name,
    '회차':        String(p.slot || '').trim(),
    '이름':        String(p.name || '').trim(),
    '증정코드':    code,
    '증정여부':    '',
    '증정시각':    '',
    '게시물 링크': String(p.link || '').trim(),
    '캡처 이미지': String(p.img || '').trim()      // 드라이브에 올린 파일 주소
  };

  var row = header.map(function (h) {
    if (fixed[h] !== undefined) return fixed[h];
    var v = answers[h];
    if (v === undefined || v === null) return '';
    return Array.isArray(v) ? v.join(', ') : String(v);   // 복수응답은 쉼표로
  });
  sh.appendRow(row);

  return {
    ok: true, done: true, type: type, survey: meta.name,
    gift: gift, giftItem: giftItem, giftLabel: giftLabel_(giftItem), code: code
  };
}

/** 사람이 불러줄 수 있게 짧고 헷갈리지 않는 코드 (I,O,0,1 제외) */
function giftCode_() {
  var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  for (var i = 0; i < 4; i++) out += A.charAt(Math.floor(Math.random() * A.length));
  return 'HM-' + out;
}

/** 이미 쓰인 증정 코드인지 — 4자리라 드물지만 겹치면 집계가 엉킨다 */
function giftCodeTaken_(code) {
  var types = Object.keys(FIELD.SURVEYS);
  for (var t = 0; t < types.length; t++) {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIELD.SURVEYS[types[t]].tab);
    if (!sh || sh.getLastRow() < 2) continue;
    var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
    var c = header.indexOf('증정코드') + 1;
    if (!c) continue;
    var vals = sh.getRange(2, c, sh.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < vals.length; r++) {
      if (String(vals[r][0]).trim().toUpperCase() === code) return true;
    }
  }
  return false;
}

function b64urlDecode_(str) {
  var b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString('UTF-8');
}

/**
 * 설문 증정 코드 확인 — action=gift&code=HM-7K3D&k=키
 * 코드를 찾아 아직 안 준 것이면 스티커 1개를 증정 처리하고 재고를 깎는다.
 * 이미 준 코드는 거절한다(같은 코드로 두 번 받아가는 것을 막는다).
 */
/** 이 설문을 쓰면 무엇을 드리는지 — SNS 후기는 액자, 나머지는 스티커 */
function giftItemFor_(type) {
  var meta = FIELD.SURVEYS[type];
  return (meta && meta.gift) ? meta.gift : FIELD.GIFT_ITEM;
}

/** 화면에 띄울 이름. '스티커 증정' 은 내부 상품 키라 손님 앞에서 쓸 말이 아니다. */
function giftLabel_(item) {
  return item === FIELD.GIFT_ITEM ? '데코 스티커' : item;
}

function actGift_(p) {
  requireKey_(p);
  var code = String(p.code || '').trim().toUpperCase();
  if (!/^HM-[A-Z0-9]{4}$/.test(code)) throw new Error('코드 형식이 올바르지 않습니다. (예: HM-7K3D)');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var types = Object.keys(FIELD.SURVEYS);
    for (var t = 0; t < types.length; t++) {
      var meta = FIELD.SURVEYS[types[t]];
      var item = giftItemFor_(types[t]);
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(meta.tab);
      if (!sh || sh.getLastRow() < 2) continue;

      var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
      var cCode = header.indexOf('증정코드') + 1;
      var cDone = header.indexOf('증정여부') + 1;
      var cWhen = header.indexOf('증정시각') + 1;
      var cSlot = header.indexOf('회차') + 1;
      var cName = header.indexOf('이름') + 1;
      if (!cCode) continue;

      var codes = sh.getRange(2, cCode, sh.getLastRow() - 1, 1).getValues();
      for (var r = 0; r < codes.length; r++) {
        if (String(codes[r][0]).trim().toUpperCase() !== code) continue;

        var row = r + 2;
        var done = cDone ? String(sh.getRange(row, cDone).getValue()).trim() : '';
        if (done) {
          var when = cWhen ? String(sh.getRange(row, cWhen).getValue()).trim() : '';
          throw new Error('이미 증정된 코드입니다' + (when ? ' (' + when + ')' : '') + '.');
        }

        var slot = cSlot ? String(sh.getRange(row, cSlot).getValue()).trim() : '';
        var name = cName ? String(sh.getRange(row, cName).getValue()).trim() : '';
        if (cDone) sh.getRange(row, cDone).setValue('증정');
        if (cWhen) sh.getRange(row, cWhen).setValue(nowStamp_());

        // 판매 시트에도 남긴다 — 매출 0원, 재고는 해당 품목에서 나간다
        var sale = ensureSheet_(FIELD.TAB_SALE, FIELD.HEAD_SALE);
        sale.appendRow([nowStamp_(), item, 0, 1, 0, '설문증정',
                        slot + (name ? '|' + name : ''), String(p.staff || '').trim(), '']);
        bumpStock_(stockKeyOf_(item), 1);

        return { ok: true, survey: meta.name, name: name,
                 item: item, label: giftLabel_(item),
                 remain: stockRemain_(stockRows_().map[stockKeyOf_(item)] || { total: 0, used: 0, adj: 0 }) };
      }
    }
    throw new Error('없는 코드입니다. 설문 완료 화면의 코드를 다시 확인해 주세요.');
  } finally {
    lock.releaseLock();
  }
}

/** 설문 종류별 응답 수 */
function surveyCounts_() {
  var out = { byType: {}, experience: 0, purchase: 0, sns: 0, total: 0, gifted: 0 };
  Object.keys(FIELD.SURVEYS).forEach(function (t) {
    var meta = FIELD.SURVEYS[t];
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(meta.tab);
    var n = 0, g = 0;
    if (sh && sh.getLastRow() > 1) {
      var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
      var cDone = header.indexOf('증정여부') + 1;
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
      vals.forEach(function (r) {
        if (String(r[0]).trim() === '') return;
        n++;
        if (cDone && String(r[cDone - 1]).trim()) g++;
      });
    }
    out.byType[t] = { name: meta.name, count: n, gifted: g };
    out[meta.group] += n;
    out.total += n;
    out.gifted += g;
  });
  return out;
}

/* ══════════════════════════════════════════════════════════════
   5-3. 구글 드라이브 — 캡처 이미지와 집계 백업
   ══════════════════════════════════════════════════════════════ */
/** 행사 자료 폴더. 없으면 내 드라이브에 만든다. */
function eventFolder_() {
  var it = DriveApp.getFoldersByName(FIELD.DRIVE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FIELD.DRIVE_FOLDER);
}

function imageFolder_() {
  var parent = eventFolder_();
  var it = parent.getFoldersByName(FIELD.DRIVE_IMAGE_SUBFOLDER);
  return it.hasNext() ? it.next() : parent.createFolder(FIELD.DRIVE_IMAGE_SUBFOLDER);
}

/**
 * 캡처 이미지 업로드 — action=img&sid=..&i=0&n=12&d=<base64url 조각>&name=홍길동
 *
 * 사진은 그대로 보내면 GET 한 번에 안 들어간다. 설문 화면에서 미리 줄여
 * 100KB 안팎으로 만든 뒤 조각내 보내고, 마지막 조각에서 드라이브에 저장한다.
 * 저장한 파일 주소를 돌려주면 설문 제출 때 그 주소를 함께 기록한다.
 */
function actImage_(p) {
  var sid = String(p.sid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  var idx = parseInt(p.i, 10);
  var tot = parseInt(p.n, 10);
  var data = String(p.d || '');
  if (!sid || isNaN(idx) || isNaN(tot) || tot < 1) throw new Error('전송 정보가 올바르지 않습니다.');

  var cache = CacheService.getScriptCache();
  var guard = 'imgdone_' + sid;
  var prev = cache.get(guard);
  if (prev) return JSON.parse(prev);          // 재전송이면 이미 만든 파일을 그대로 돌려준다

  cache.put('img_' + sid + '_' + idx, data, 900);

  var parts = [];
  for (var i = 0; i < tot; i++) {
    var part = (i === idx) ? data : cache.get('img_' + sid + '_' + i);
    if (part === null) return { ok: true, received: idx + 1, of: tot, done: false };
    parts.push(part);
  }

  var b64 = parts.join('').replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';

  var who   = String(p.name || '익명').replace(/[\\/:*?"<>|]/g, '').slice(0, 20);
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss');
  var blob  = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg',
                                'SNS_' + who + '_' + stamp + '.jpg');

  var file = imageFolder_().createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) {}

  var out = { ok: true, done: true, url: file.getUrl(), id: file.getId(), name: file.getName() };
  cache.put(guard, JSON.stringify(out), 900);
  for (var j = 0; j < tot; j++) cache.remove('img_' + sid + '_' + j);
  return out;
}

/**
 * 집계 스냅샷 — action=snapshot&k=키
 * 지금 시점의 집계를 '집계' 탭에 쓰고, 같은 내용을 드라이브에도 남긴다.
 * 행사 종료 직후 한 번 눌러두면 결과보고서를 쓸 때 그 시점 숫자가 보존된다.
 */
function actSnapshot_(p) {
  requireKey_(p);
  var r = buildReport_();
  var rows = snapshotRows_(r);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('집계');
  if (!sh) sh = ss.insertSheet('집계');
  sh.clear();
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#efe9e0');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 4);

  // 드라이브에도 같은 내용을 CSV 로 남긴다 (시트를 잘못 건드려도 근거가 남는다)
  var csv = rows.map(function (row) {
    return row.map(function (c) {
      var v = String(c === null || c === undefined ? '' : c);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(',');
  }).join('\n');

  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmm');
  var folder = eventFolder_();
  var csvFile  = folder.createFile(Utilities.newBlob('\uFEFF' + csv, 'text/csv', '집계_' + stamp + '.csv'));
  var jsonFile = folder.createFile(Utilities.newBlob(JSON.stringify(r, null, 2), 'application/json', '집계_' + stamp + '.json'));

  return { ok: true, rows: rows.length - 1, csv: csvFile.getUrl(), json: jsonFile.getUrl(),
           folder: folder.getUrl(), at: r.generatedAt };
}

/** 집계 탭에 쓸 내용 — 결과보고서 항목 순서 그대로 */
function snapshotRows_(r) {
  var T = r.targets, A = r.attendance, S = r.sales;
  var item = function (k) { return S.byItem[k] || { qty: 0, amount: 0 }; };
  var pct  = function (v, t) { return t ? (Math.round(v / t * 1000) / 10) + '%' : '–'; };
  var rows = [['항목', '실적', '목표', '달성률']];
  // 값 없이 부르면 구분선(섹션 제목)으로 본다
  var add  = function (a, b, c, d) {
    if (b === undefined) { rows.push([a, '', '', '']); return; }
    rows.push([a, b, c === undefined ? '' : c, d === undefined ? '' : d]);
  };

  add('■ 체험 프로그램');
  add('컬러링 체험 (무료)', A.coloring + '명', T.coloring + '명', pct(A.coloring, T.coloring));
  add('자개바인더 체험',    A.binder + '명',   T.binder + '명',   pct(A.binder, T.binder));
  add('노쇼',               (A.noshowColoring + A.noshowBinder) + '명');

  add('■ 판매');
  add('바인더 체험료',   item('바인더 체험').qty + '건',   T.binder + '건',        pct(item('바인더 체험').qty, T.binder));
  add('바인더 완성품',   item('바인더 완성품').qty + '개', T.binderProduct + '개', pct(item('바인더 완성품').qty, T.binderProduct));
  add('데코 스티커 판매', item('스티커').qty + '개',       T.sticker + '개',       pct(item('스티커').qty, T.sticker));
  add('데코 스티커 증정', item(FIELD.GIFT_ITEM).qty + '개');
  add('총 매출',         S.revenue + '원', T.revenue + '원', pct(S.revenue, T.revenue));
  Object.keys(S.byPay).forEach(function (k) { add('  · ' + k, S.byPay[k] + '원'); });

  add('■ 설문');
  add('설문 응답 합계', r.survey.count + '건', T.survey + '건', pct(r.survey.count, T.survey));
  Object.keys(r.survey.byType || {}).forEach(function (k) {
    add('  · ' + r.survey.byType[k].name, r.survey.byType[k].count + '건');
  });
  add('SNS 후기 인증', r.survey.sns + '건', T.sns + '건', pct(r.survey.sns, T.sns));
  add('액자 증정',     r.survey.frames + '개', T.sns + '개', pct(r.survey.frames, T.sns));

  add('■ 도안별 선택');
  Object.keys(r.designs).forEach(function (k) { add('  · ' + k, r.designs[k] + '건'); });

  add('■ 운영 관찰');
  Object.keys(r.tags).forEach(function (k) { add('  · ' + k, r.tags[k] + '건'); });
  add('30분 내 미완성', r.unfinished + '건');

  add('■ 무료 → 유료 전환');
  add('무료 참석', r.conversion.freeAttend + '명');
  add('그중 구매', r.conversion.converted + '명', '', r.conversion.rate + '%');

  add('■ 종료 시점 재고');
  (r.stock || []).forEach(function (x) { add('  · ' + x.key, x.remain + ' / ' + x.total, '소진 ' + x.used); });

  add('집계 시각', r.generatedAt);
  return rows;
}

/** 스프레드시트 메뉴 — 대표님이 버튼으로 스냅샷을 남길 수 있게 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('헬로미추')
    .addItem('현장 데이터 탭 만들기', 'setupFieldSheets')
    .addItem('집계 스냅샷 저장 (시트 + 드라이브)', 'snapshotFromMenu')
    .addToUi();
}

function snapshotFromMenu() {
  var r = actSnapshot_({ k: FIELD.STAFF_KEY });
  SpreadsheetApp.getActiveSpreadsheet().toast(
    '집계 탭과 드라이브에 저장했습니다.\n' + r.at, '헬로미추', 8);
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
  var sv = surveyCounts_();
  var survey = sv.total;
  // 예전 구글 폼 시트가 남아 있으면 그 응답도 더한다 (이관 중 유실 방지)
  survey += countFormRows_(typeof CONFIG !== 'undefined' ? CONFIG.SURVEY_SHEET_NAME : '');

  // SNS 후기도 이제 이 시스템이 직접 받는다. 예전 구글 폼 시트가 남아 있으면 함께 센다.
  var sns = (sv.byType.sns ? sv.byType.sns.count : 0) +
            countFormRows_(typeof CONFIG !== 'undefined' ? CONFIG.SNS_SHEET_NAME : '');
  var framesGiven = (byItem['액자'] && byItem['액자'].qty) || 0;
  if (!sns) sns = framesGiven;   // 아직 한 건도 없으면 액자 증정 건수로 대신한다

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
    survey:     { count: survey, sns: sns, frames: framesGiven,
                  byType: sv.byType, experience: sv.experience, purchase: sv.purchase,
                  gifted: sv.gifted, stickerGift: (byItem[FIELD.GIFT_ITEM] || {}).qty || 0 },
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
