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
  // 시간대 1칸당 정원
  CAPACITY: 10,

  // 응답이 쌓이는 시트 이름. 빈 문자열이면 폼 연결 시트를 자동으로 찾습니다.
  SHEET_NAME: '',

  // 헤더(1행)에서 찾을 컬럼 이름. 부분 일치로 찾습니다.
  COL_DATE:   '날짜',
  COL_TIME:   '시간',

  // 정원 초과 시 취소 표시를 기록할 컬럼. 없으면 스크립트가 맨 뒤에 만듭니다.
  COL_STATUS: '처리상태',

  // 이 값이 들어 있는 행은 정원 계산에서 제외합니다(수동 취소·노쇼 포함).
  EXCLUDE_STATUS: ['취소', '노쇼', '정원초과'],

  // 행사 날짜 — 폼의 '날짜' 선택지와 글자까지 똑같아야 합니다.
  DATES: ['5월 30일 (토)', '5월 31일 (일)'],

  // 운영 시간 (20분 단위)
  START_TIME: '11:00',
  END_TIME:   '19:40',
  INTERVAL_MIN: 20,

  // 행사 연도 — 지난 시간대 판정에 사용
  YEAR: 2026,

  // 정원 초과 접수가 발생하면 알림을 받을 주소. 빈 문자열이면 보내지 않습니다.
  NOTIFY_EMAIL: '',
};

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

    const date = String(sheet.getRange(row, cols.date).getValue()).trim();
    const time = normalizeTime_(sheet.getRange(row, cols.time).getValue());
    if (!date || !time) return;

    // 이 행을 포함해 같은 시간대의 유효 접수 건수를 센다
    const counts = countBySlot_(sheet, cols);
    const key    = slotKey_(date, time);
    const count  = counts[key] || 0;

    if (count > CONFIG.CAPACITY) {
      // 정원을 넘긴 접수 → 자동 취소 표시
      sheet.getRange(row, cols.status).setValue(
        '정원초과 자동취소 (' + count + '/' + CONFIG.CAPACITY + ')'
      );
      sheet.getRange(row, 1, 1, sheet.getLastColumn())
           .setBackground('#fdecea');

      if (CONFIG.NOTIFY_EMAIL) {
        MailApp.sendEmail(
          CONFIG.NOTIFY_EMAIL,
          '[헬로미추] 정원 초과 접수 발생',
          date + ' ' + time + ' 시간대에 정원(' + CONFIG.CAPACITY + '명)을 초과한 접수가 들어와 ' +
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

  const slots  = getSlotAvailability();
  const byTime = {};
  slots.forEach(s => {
    if (!byTime[s.time]) byTime[s.time] = [];
    byTime[s.time].push(s);
  });

  // 날짜/시간이 별도 질문이므로, "선택 가능한 모든 날짜에서 마감"인 시간만 제거할 수 있다.
  const openDates = CONFIG.DATES.filter(d => !isDatePast_(d));
  const openTimes = allTimes_().filter(t => {
    const list = (byTime[t] || []).filter(s => openDates.indexOf(s.date) !== -1);
    return list.some(s => s.remain > 0 && !s.past);
  });

  const timeItem = findItem_(form, CONFIG.COL_TIME);
  if (timeItem) setChoices_(timeItem, openTimes);

  const openDateList = openDates.filter(d =>
    slots.some(s => s.date === d && s.remain > 0 && !s.past)
  );
  const dateItem = findItem_(form, CONFIG.COL_DATE);
  if (dateItem) setChoices_(dateItem, openDateList);

  // 전 시간대 마감이면 폼 자체를 닫는다
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
  CONFIG.DATES.forEach(date => {
    times.forEach(time => {
      const used = counts[slotKey_(date, time)] || 0;
      slots.push({
        date:     date,
        time:     time,
        capacity: CONFIG.CAPACITY,
        remain:   Math.max(0, CONFIG.CAPACITY - used),
        past:     isSlotPast_(date, time),
      });
    });
  });
  return slots;
}

/**
 * 기존 doGet 이 없다면 아래 주석을 풀어 그대로 쓰면 됩니다.
 * 이미 doGet 이 있다면 그 안에서 getSlotAvailability() 를 slots 로 넣어주세요.
 */
// function doGet() {
//   const payload = { slots: getSlotAvailability(), sheetStock: [] };
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

  const date = find(CONFIG.COL_DATE);
  const time = find(CONFIG.COL_TIME);
  if (!date || !time) {
    throw new Error(
      '헤더에서 "' + CONFIG.COL_DATE + '" / "' + CONFIG.COL_TIME + '" 컬럼을 찾지 못했습니다. ' +
      'CONFIG.COL_DATE, CONFIG.COL_TIME 값을 실제 질문 제목에 맞게 바꿔주세요. (현재 헤더: ' + header.join(' | ') + ')'
    );
  }

  let status = find(CONFIG.COL_STATUS);
  if (!status) {
    status = lastCol + 1;
    sheet.getRange(1, status).setValue(CONFIG.COL_STATUS);
  }
  return { date: date, time: time, status: status };
}

/** 시간대별 유효 접수 건수 (취소/노쇼/정원초과 제외) */
function countBySlot_(sheet, cols) {
  const counts   = {};
  const lastRow  = sheet.getLastRow();
  if (lastRow < 2) return counts;

  const width  = Math.max(cols.date, cols.time, cols.status);
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();

  values.forEach(r => {
    const date   = String(r[cols.date - 1]).trim();
    const time   = normalizeTime_(r[cols.time - 1]);
    const status = String(r[cols.status - 1] || '');
    if (!date || !time) return;
    if (CONFIG.EXCLUDE_STATUS.some(x => status.indexOf(x) !== -1)) return;

    const key = slotKey_(date, time);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function slotKey_(date, time) {
  return date + '|' + time;
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

/** '5월 31일 (일)' → {month, day} */
function parseDate_(dateLabel) {
  const m = String(dateLabel).match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  return m ? { month: Number(m[1]), day: Number(m[2]) } : null;
}

function nowKst_() {
  return new Date(
    Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy/MM/dd HH:mm:ss")
  );
}

function isSlotPast_(dateLabel, time) {
  const d = parseDate_(dateLabel);
  if (!d) return false;
  const p   = time.split(':');
  const end = new Date(CONFIG.YEAR, d.month - 1, d.day, Number(p[0]), Number(p[1]) + CONFIG.INTERVAL_MIN);
  return nowKst_().getTime() >= end.getTime();
}

function isDatePast_(dateLabel) {
  const d = parseDate_(dateLabel);
  if (!d) return false;
  const endOfDay = new Date(CONFIG.YEAR, d.month - 1, d.day, 23, 59, 59);
  return nowKst_().getTime() > endOfDay.getTime();
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
  Logger.log('마감된 시간대: %s', full.map(s => s.date + ' ' + s.time).join(', ') || '없음');
  Logger.log(JSON.stringify(slots.slice(0, 5), null, 2));
}
