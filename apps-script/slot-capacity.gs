/**
 * 시간대별 정원(기본 10명) 자동 마감 스크립트
 * ─────────────────────────────────────────────
 * 구글 폼 → 스프레드시트로 응답이 쌓이는 기존 방식을 그대로 두고,
 * 정원이 찬 시간대를 폼에서 자동으로 없애고 초과 접수를 자동 취소 처리합니다.
 *
 * 설치 방법은 apps-script/README.md 참고.
 * 기존 doGet(잔여 현황 API)이 있다면 이 파일을 별도 .gs 파일로 추가한 뒤,
 * doGet 안에서 getSlotAvailability() 결과를 slots 로 내려주면 됩니다.
 */

const CONFIG = {
  // 예약 프로그램별 정원 — 같은 타임을 공유하되 정원은 따로 관리한다
  PROGRAMS: [
    { key: '컬러링', capacity: 6 },
    { key: '바인더', capacity: 4 },
  ],

  // 응답이 쌓이는 시트 이름. 빈 문자열이면 폼 연결 시트를 자동으로 찾습니다.
  SHEET_NAME: '',

  // 헤더(1행)에서 찾을 컬럼 이름. 부분 일치로 찾습니다.
  COL_PROGRAM: '프로그램',
  COL_TIME:    '시간',

  // 정원 초과 시 취소 표시를 기록할 컬럼. 없으면 스크립트가 맨 뒤에 만듭니다.
  COL_STATUS: '처리상태',

  // 이 값이 들어 있는 행은 정원 계산에서 제외합니다(수동 취소·노쇼 포함).
  EXCLUDE_STATUS: ['취소', '노쇼', '정원초과'],

  // 행사 날짜 (하루)
  EVENT_DATE: '9월 19일 (토)',

  // 운영 시간 (30분 단위 10타임)
  START_TIME: '13:30',
  END_TIME:   '18:00',
  INTERVAL_MIN: 30,

  // 행사 연도 — 지난 시간대 판정에 사용
  YEAR: 2026,
  MONTH: 9,
  DAY: 19,

  // ── 굿즈 재고 (예약 대상 아님, 사이트 표시용) ──
  GOODS: [
    { key: '바인더 체험',   total: 40 },
    { key: '바인더 완성품', total: 50 },
    { key: '스티커',       total: 100 },
  ],

  // ── SNS 후기 액자 (시간대와 무관한 전체 선착순) ──
  FRAME_TOTAL: 28,

  // ── 체험 설문 시트 (이탈 방지용 운영 화면에 사용) ──
  SURVEY_SHEET_NAME: '',              // 빈 문자열이면 설문 진행률 집계를 건너뜁니다
  SURVEY_COL_PROGRAM: '프로그램',
  SURVEY_COL_TIME:    '시간',

  // 후기 인증 설문 응답 시트 — 링크·이미지를 받고 운영자가 확인 처리하는 시트
  SNS_SHEET_NAME: '',                 // 빈 문자열이면 액자 카운트를 건너뜁니다
  SNS_COL_LINK:   '링크',              // SNS 게시물 URL 컬럼
  SNS_COL_IMAGE:  '이미지',            // 캡처 이미지 업로드 컬럼
  SNS_COL_VERIFY: '확인',              // 운영자 확인 컬럼 (아래 값이 들어가면 액자 1개 차감)
  SNS_VERIFIED_VALUES: ['확인', '증정', 'O', 'o', 'Y', 'y', 'TRUE', 'true'],

  // 정원 초과 접수가 발생하면 알림을 받을 주소. 빈 문자열이면 보내지 않습니다.
  NOTIFY_EMAIL: '',
};

function capacityOf_(program) {
  const p = CONFIG.PROGRAMS.filter(x => x.key === program)[0];
  return p ? p.capacity : CONFIG.PROGRAMS[0].capacity;
}

/* ──────────────────────────────────────────────
   1. 최초 1회 실행 — 트리거 설치
   ────────────────────────────────────────────── */
function setupTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 중복 설치 방지
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['onFormSubmitGuard', 'syncFormChoices'].indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 폼 제출 직후 정원 검사
  ScriptApp.newTrigger('onFormSubmitGuard').forSpreadsheet(ss).onFormSubmit().create();

  // 폼을 열어둔 채 대기 중인 사람까지 커버하기 위한 주기 동기화
  ScriptApp.newTrigger('syncFormChoices').timeBased().everyMinutes(5).create();

  syncFormChoices();
  Logger.log('트리거 설치 완료');
}

/* ──────────────────────────────────────────────
   2. 폼 제출 시 — 정원 초과분 자동 취소
   ────────────────────────────────────────────── */
function onFormSubmitGuard(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);   // 동시 제출 시 순서대로 처리
  } catch (err) {
    Logger.log('lock 획득 실패: ' + err);
    return;
  }

  try {
    const sheet = getSheet_();
    const cols  = getColumns_(sheet);
    const row   = e && e.range ? e.range.getRow() : sheet.getLastRow();

    const program = normalizeProgram_(sheet.getRange(row, cols.program).getValue());
    const time    = normalizeTime_(sheet.getRange(row, cols.time).getValue());
    if (!program || !time) return;

    // 이 행을 포함해 같은 프로그램·시간대의 유효 접수 건수를 센다
    const counts   = countBySlot_(sheet, cols);
    const capacity = capacityOf_(program);
    const count    = counts[slotKey_(program, time)] || 0;

    if (count > capacity) {
      // 정원을 넘긴 접수 → 자동 취소 표시
      sheet.getRange(row, cols.status).setValue(
        '정원초과 자동취소 (' + count + '/' + capacity + ')'
      );
      sheet.getRange(row, 1, 1, sheet.getLastColumn())
           .setBackground('#fdecea');

      if (CONFIG.NOTIFY_EMAIL) {
        MailApp.sendEmail(
          CONFIG.NOTIFY_EMAIL,
          '[헬로미추] 정원 초과 접수 발생',
          program + ' ' + time + ' 회차에 정원(' + capacity + '명)을 초과한 접수가 들어와 ' +
          '자동 취소 처리했습니다.\n스프레드시트 ' + row + '행을 확인하고 신청자에게 안내해 주세요.'
        );
      }
    }

    // 정원이 찼으면 폼 선택지에서 해당 시간대를 즉시 제거
    syncFormChoices();

  } finally {
    lock.releaseLock();
  }
}

/* ──────────────────────────────────────────────
   3. 폼 선택지 동기화 — 마감된 시간대 제거
   ────────────────────────────────────────────── */
function syncFormChoices() {
  const form = getForm_();
  if (!form) return;

  const slots = getSlotAvailability();

  // 프로그램이 하나뿐인 폼이면 시간 선택지를 바로 정리할 수 있다.
  // 프로그램이 둘이면 "모든 프로그램에서 마감된 시간"만 안전하게 지울 수 있다.
  const openTimes = allTimes_().filter(t =>
    slots.some(s => s.time === t && s.remain > 0 && !s.past)
  );
  const timeItem = findItem_(form, CONFIG.COL_TIME);
  if (timeItem) setChoices_(timeItem, openTimes);

  // 프로그램 전체가 마감되면 프로그램 선택지에서 뺀다
  const openPrograms = CONFIG.PROGRAMS
    .map(p => p.key)
    .filter(k => slots.some(s => s.program === k && s.remain > 0 && !s.past));
  const progItem = findItem_(form, CONFIG.COL_PROGRAM);
  if (progItem) setChoices_(progItem, openPrograms);

  // 전 회차 마감이면 폼 자체를 닫는다
  const anyOpen = slots.some(s => s.remain > 0 && !s.past);
  if (!anyOpen && form.isAcceptingResponses()) {
    form.setAcceptingResponses(false);
    form.setCustomClosedFormMessage('예약이 모두 마감되었습니다. 현장 대기 접수는 부스에서 안내해 드립니다.');
  } else if (anyOpen && !form.isAcceptingResponses()) {
    form.setAcceptingResponses(true);
  }
}

/* ──────────────────────────────────────────────
   4. 잔여 현황 — 웹사이트 API 용
   ────────────────────────────────────────────── */
function getSlotAvailability() {
  const sheet  = getSheet_();
  const cols   = getColumns_(sheet);
  const counts = countBySlot_(sheet, cols);
  const times  = allTimes_();

  const slots = [];
  CONFIG.PROGRAMS.forEach(p => {
    times.forEach(time => {
      const used = counts[slotKey_(p.key, time)] || 0;
      slots.push({
        program:  p.key,
        date:     CONFIG.EVENT_DATE,
        time:     time,
        capacity: p.capacity,
        remain:   Math.max(0, p.capacity - used),
        past:     isSlotPast_(time),
      });
    });
  });
  return slots;
}

/**
 * SNS 후기 액자 잔여 — 시간대 정원이 아니라 전체 선착순 카운터.
 * 후기 인증 설문 시트에서 운영자가 '확인' 처리한 건수만큼 차감한다.
 */
function getFrameRemain() {
  const total = CONFIG.FRAME_TOTAL;
  if (!CONFIG.SNS_SHEET_NAME) return total;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SNS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return total;

  const lastCol = sheet.getLastColumn();
  const header  = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v).trim());
  let verifyCol = 0;
  for (let i = 0; i < header.length; i++) {
    if (header[i].indexOf(CONFIG.SNS_COL_VERIFY) !== -1) { verifyCol = i + 1; break; }
  }
  if (!verifyCol) {
    verifyCol = lastCol + 1;
    sheet.getRange(1, verifyCol).setValue(CONFIG.SNS_COL_VERIFY);
    return total;
  }

  const values = sheet.getRange(2, verifyCol, sheet.getLastRow() - 1, 1).getValues();
  let used = 0;
  values.forEach(r => {
    const v = String(r[0]).trim();
    if (v && CONFIG.SNS_VERIFIED_VALUES.indexOf(v) !== -1) used++;
  });
  return Math.max(0, total - used);
}

/**
 * 회차별 설문 진행률 — 체험 후 설문을 안 하고 가는 이탈을 잡기 위한 운영용 집계.
 * 예약 인원과 설문 응답 수를 회차 단위로 맞춰 보여준다.
 */
function getSurveyProgress() {
  const sheet  = getSheet_();
  const cols   = getColumns_(sheet);
  const booked = countBySlot_(sheet, cols);
  const surveyed = countSurveyBySlot_();

  const rows = [];
  CONFIG.PROGRAMS.forEach(p => {
    allTimes_().forEach(time => {
      const key = slotKey_(p.key, time);
      const b   = booked[key] || 0;
      if (!b) return;                       // 예약이 없는 회차는 표시하지 않는다
      const d = surveyed[key] || 0;
      rows.push({
        program: p.key,
        time:    time,
        booked:  b,
        done:    d,
        missing: Math.max(0, b - d),
        past:    isSlotPast_(time),
      });
    });
  });
  return rows;
}

function countSurveyBySlot_() {
  const counts = {};
  if (!CONFIG.SURVEY_SHEET_NAME) return counts;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SURVEY_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return counts;

  const lastCol = sheet.getLastColumn();
  const header  = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v).trim());
  const find = name => {
    for (let i = 0; i < header.length; i++) {
      if (header[i].indexOf(name) !== -1) return i + 1;
    }
    return 0;
  };
  const pc = find(CONFIG.SURVEY_COL_PROGRAM);
  const tc = find(CONFIG.SURVEY_COL_TIME);
  if (!pc || !tc) return counts;            // 설문 폼에 회차 문항이 없으면 집계 불가

  const width  = Math.max(pc, tc);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  values.forEach(r => {
    const program = normalizeProgram_(r[pc - 1]);
    const time    = normalizeTime_(r[tc - 1]);
    if (!program || !time) return;
    const key = slotKey_(program, time);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

/** 굿즈 재고 — 판매 기록 시트가 없으면 총 수량을 그대로 내려준다 */
function getGoodsStock() {
  const goods = CONFIG.GOODS.map(g => ({ key: g.key, remain: g.total }));
  goods.push({ key: '액자', remain: getFrameRemain() });
  return goods;
}

/**
 * 기존 doGet 이 없다면 아래 주석을 풀어 그대로 쓰면 됩니다.
 * 이미 doGet 이 있다면 그 안에서 slots / goods 를 넣어주세요.
 */
// function doGet() {
//   const payload = {
//     slots:      getSlotAvailability(),
//     sheetStock: [],                     // 도안 재고 (기존 로직 유지)
//     goods:      getGoodsStock(),
//     surveyProgress: getSurveyProgress() // 운영 화면(staff.html)용
//   };
//   return ContentService.createTextOutput(JSON.stringify(payload))
//                        .setMimeType(ContentService.MimeType.JSON);
// }

/* ──────────────────────────────────────────────
   내부 유틸
   ────────────────────────────────────────────── */
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (CONFIG.SHEET_NAME) {
    const s = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (s) return s;
  }
  // 폼 연결 시트를 우선 사용
  const linked = ss.getSheets().filter(s => s.getFormUrl());
  return linked.length ? linked[0] : ss.getSheets()[0];
}

function getForm_() {
  const url = getSheet_().getFormUrl();
  return url ? FormApp.openByUrl(url) : null;
}

/** 헤더에서 날짜/시간/처리상태 컬럼 위치를 찾는다. 처리상태가 없으면 만든다. */
function getColumns_(sheet) {
  const lastCol = sheet.getLastColumn();
  const header  = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v).trim());

  const find = name => {
    for (let i = 0; i < header.length; i++) {
      if (header[i].indexOf(name) !== -1) return i + 1;
    }
    return 0;
  };

  const program = find(CONFIG.COL_PROGRAM);
  const time    = find(CONFIG.COL_TIME);
  if (!program || !time) {
    throw new Error(
      '헤더에서 "' + CONFIG.COL_PROGRAM + '" / "' + CONFIG.COL_TIME + '" 컬럼을 찾지 못했습니다. ' +
      'CONFIG.COL_PROGRAM, CONFIG.COL_TIME 값을 실제 질문 제목에 맞게 바꿔주세요. (현재 헤더: ' + header.join(' | ') + ')'
    );
  }

  let status = find(CONFIG.COL_STATUS);
  if (!status) {
    status = lastCol + 1;
    sheet.getRange(1, status).setValue(CONFIG.COL_STATUS);
  }
  return { program: program, time: time, status: status };
}

/** 폼 답변에서 프로그램 키를 뽑아낸다 ('컬러링 체험' → '컬러링') */
function normalizeProgram_(value) {
  const v = String(value).trim();
  for (let i = 0; i < CONFIG.PROGRAMS.length; i++) {
    if (v.indexOf(CONFIG.PROGRAMS[i].key) !== -1) return CONFIG.PROGRAMS[i].key;
  }
  return v;
}

/** 시간대별 유효 접수 건수 (취소/노쇼/정원초과 제외) */
function countBySlot_(sheet, cols) {
  const counts   = {};
  const lastRow  = sheet.getLastRow();
  if (lastRow < 2) return counts;

  const width  = Math.max(cols.program, cols.time, cols.status);
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();

  values.forEach(r => {
    const program = normalizeProgram_(r[cols.program - 1]);
    const time    = normalizeTime_(r[cols.time - 1]);
    const status  = String(r[cols.status - 1] || '');
    if (!program || !time) return;
    if (CONFIG.EXCLUDE_STATUS.some(x => status.indexOf(x) !== -1)) return;

    const key = slotKey_(program, time);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function slotKey_(program, time) {
  return program + '|' + time;
}

/** 셀 값이 Date 객체로 저장돼도 "HH:mm" 문자열로 통일 */
function normalizeTime_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'Asia/Seoul', 'HH:mm');
  }
  const s = String(value).trim();
  const m = s.match(/(\d{1,2})\s*:\s*(\d{2})/);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : s;
}

function allTimes_() {
  const toMin = t => {
    const p = t.split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  };
  const out = [];
  for (let m = toMin(CONFIG.START_TIME); m <= toMin(CONFIG.END_TIME); m += CONFIG.INTERVAL_MIN) {
    out.push(('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2));
  }
  return out;
}

function nowKst_() {
  return new Date(
    Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy/MM/dd HH:mm:ss")
  );
}

/** 슬롯 종료(시작 + INTERVAL_MIN)가 지났는지 */
function isSlotPast_(time) {
  const p   = time.split(':');
  const end = new Date(CONFIG.YEAR, CONFIG.MONTH - 1, CONFIG.DAY,
                       Number(p[0]), Number(p[1]) + CONFIG.INTERVAL_MIN);
  return nowKst_().getTime() >= end.getTime();
}

/** 제목에 name 이 들어가는 객관식/드롭다운 문항 찾기 */
function findItem_(form, name) {
  const items = form.getItems();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.getTitle().indexOf(name) === -1) continue;
    const type = it.getType();
    if (type === FormApp.ItemType.MULTIPLE_CHOICE) return it.asMultipleChoiceItem();
    if (type === FormApp.ItemType.LIST)            return it.asListItem();
  }
  return null;
}

/** 선택지 교체 (남은 선택지가 없으면 그대로 두고 폼을 닫는 쪽으로 처리) */
function setChoices_(item, values) {
  if (!values || !values.length) return;
  const current = item.getChoices().map(c => c.getValue());
  if (current.length === values.length && current.every((v, i) => v === values[i])) return;  // 변경 없음
  item.setChoices(values.map(v => item.createChoice(v)));
}

/* ──────────────────────────────────────────────
   점검용 — 에디터에서 직접 실행해 로그로 확인
   ────────────────────────────────────────────── */
function debugAvailability() {
  const slots = getSlotAvailability();
  const full  = slots.filter(s => s.remain === 0 && !s.past);
  Logger.log('전체 슬롯: %s개 / 마감: %s개', slots.length, full.length);
  Logger.log('마감된 회차: %s', full.map(s => s.program + ' ' + s.time).join(', ') || '없음');
  Logger.log('액자 잔여: %s / %s', getFrameRemain(), CONFIG.FRAME_TOTAL);
  const prog = getSurveyProgress();
  const miss = prog.filter(r => r.missing > 0);
  Logger.log('설문 미작성이 남은 회차: %s', miss.map(r => r.program + ' ' + r.time + ' (' + r.missing + '명)').join(', ') || '없음');
  Logger.log(JSON.stringify(slots.slice(0, 4), null, 2));
}
