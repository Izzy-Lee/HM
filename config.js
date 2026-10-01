/* ============================================================
   헬로미추 수업 만족도 — 공통 설정
   Apps Script 배포 후 받은 웹앱 URL(…/exec)을 아래에 붙여넣으세요.
   ============================================================ */
const API_URL = 'https://script.google.com/macros/s/AKfycbxjO0_LyMpx7lHzYtjwb8SLkOxXWCag1av7DJbNxbfy1jw4pevSiw5fuLiGTagZVEpY/exec';

const BRAND = {
  name: '헬로미추',
  company: '주식회사 헬로미추',
  logoText: 'Hello Michu',
  logoImg: 'img/logo2.png',
  footer: '주식회사 헬로미추 · Hello Michu',
  contact: ''
};

/* 설문 페이지 파일명 — 저장소 첫 화면이 설문이면 '', 따로 있으면 'survey.html' */
const SURVEY_PAGE = 'survey.html';

/* 체험별 운영 회차 (신청서 8쪽: 8석을 회차 배분 — 센트카드 7회차, 키링 5회차)
   키는 시트 '예약프로그램' 탭의 '키'와 같아야 합니다. 체험을 지우면 모든 회차에 열립니다. */
const PROGRAM_TIMES = {
  '센트카드': ['12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '17:30'],
  '키링': ['12:30', '13:30', '14:30', '15:30', '16:30']
};

/* 응답자 유형 */
const TYPES = [
  { id: 'kid',    label: '초등학생',        sub: '어린이 친구' },
  { id: 'teen',   label: '중·고등학생',     sub: '청소년' },
  { id: 'adult',  label: '성인 수강생',     sub: '원데이·평생교육' },
  { id: 'org',    label: '학부모·기관 담당자', sub: '보호자·교사·담당자' }
];

/* 5점 척도 항목 — key 순서 = 시트 컬럼 순서 (변경 금지) */
const ITEMS = [
  { key: 'q1', name: '전반 만족' },
  { key: 'q2', name: '흥미·참여' },
  { key: 'q3', name: '이해·난이도' },
  { key: 'q4', name: '재료·환경' },
  { key: 'q5', name: '강사' },
  { key: 'q6', name: '재참여 의향' },
  { key: 'q7', name: '추천 의향' }
];
const OPENS = [
  { key: 'o1', name: '좋았던 점' },
  { key: 'o2', name: '아쉬운 점·바라는 점' },
  { key: 'o3', name: '강사에게 한마디·기타 의견' }
];

/* 유형별 문항 문구 */
const WORDING = {
  kid: {
    scale: ['별로예요', '조금 아쉬워요', '보통이에요', '좋아요', '최고예요'],
    faces: true,
    q1: '오늘 수업 어땠어요?',
    q2: '수업이 재미있었나요?',
    q3: '선생님 설명이 잘 이해됐나요?',
    q4: '재료랑 도구는 쓰기 편했나요?',
    q5: '선생님이 친절하게 도와주셨나요?',
    q6: '이 수업 또 하고 싶나요?',
    q7: '친구에게도 알려주고 싶나요?',
    o1: '오늘 제일 좋았던 건 뭐예요?',
    o2: '조금 아쉬웠던 건 뭐예요?',
    o3: '선생님께 하고 싶은 말을 적어 주세요',
    name: '이름 (안 써도 돼요)'
  },
  teen: {
    scale: ['전혀 아니다', '아니다', '보통이다', '그렇다', '매우 그렇다'],
    q1: '수업 전반에 만족하나요?',
    q2: '수업 내용이 흥미로웠나요?',
    q3: '설명과 시범이 이해하기 쉬웠나요?',
    q4: '재료·도구·수업 환경이 적절했나요?',
    q5: '강사의 진행과 피드백에 만족하나요?',
    q6: '비슷한 수업이 있다면 다시 참여하고 싶나요?',
    q7: '친구에게 이 수업을 추천하고 싶나요?',
    o1: '좋았던 점',
    o2: '아쉬운 점이나 바라는 점',
    o3: '강사에게 한마디',
    name: '이름 (선택)'
  },
  adult: {
    scale: ['매우 불만족', '불만족', '보통', '만족', '매우 만족'],
    q1: '수업에 전반적으로 만족하십니까?',
    q2: '수업 내용이 유익하고 흥미로웠습니까?',
    q3: '설명과 시범이 이해하기 쉬웠습니까?',
    q4: '재료·도구·공간 등 수업 환경이 적절했습니까?',
    q5: '강사의 전문성과 진행에 만족하십니까?',
    q6: '다음 수업에도 참여하실 의향이 있습니까?',
    q7: '지인에게 이 수업을 추천하시겠습니까?',
    o1: '좋았던 점',
    o2: '아쉬운 점 또는 바라는 점',
    o3: '강사에게 한마디 또는 듣고 싶은 수업',
    name: '성함 (선택)'
  },
  org: {
    scale: ['매우 불만족', '불만족', '보통', '만족', '매우 만족'],
    q1: '수업에 전반적으로 만족하십니까?',
    q2: '참여자들의 흥미와 참여도가 높았습니까?',
    q3: '수업 구성과 난이도가 참여자 수준에 적절했습니까?',
    q4: '재료 준비와 수업 환경 운영이 적절했습니까?',
    q5: '강사의 전문성과 소통에 만족하십니까?',
    q6: '다음에도 이 프로그램(강사)을 운영할 의향이 있습니까?',
    q7: '다른 기관이나 지인에게 추천하시겠습니까?',
    o1: '좋았던 점',
    o2: '개선이 필요한 점',
    o3: '참여자에게서 관찰된 변화나 기타 의견',
    name: '기관명 / 성함 (선택)'
  }
};

/* JSONP 헬퍼 (GitHub Pages → Apps Script CORS 우회) */
function jsonp(params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var cb = 'cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    var s = document.createElement('script');
    var done = false;
    var t = setTimeout(function () { finish(); reject(new Error('timeout')); }, timeoutMs || 15000);
    function finish() { done = true; clearTimeout(t); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); }
    window[cb] = function (data) { if (done) return; finish(); resolve(data); };
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    s.src = API_URL + '?' + q + '&callback=' + cb + '&_=' + Date.now();
    s.onerror = function () { if (done) return; finish(); reject(new Error('network')); };
    document.head.appendChild(s);
  });
}

/* POST (응답 확인 불가한 no-cors 전송) */
function postData(obj) {
  return fetch(API_URL, {
    method: 'POST', mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(obj)
  });
}

function apiReady() { return API_URL && API_URL.indexOf('script.google.com') > -1; }
