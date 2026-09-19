# 브라우저 E2E 테스트

실제 `staff.html` / `report.html` / `index.html` 을 크로미움에서 띄우고,
실제 `apps-script/Code.gs` 를 로컬에서 실행해 붙여 돌립니다.
스프레드시트와 드라이브만 목업이고(드라이브는 test/drive_mock/ 에 실제로 파일을 씁니다),
화면과 백엔드 로직은 배포본과 같은 코드입니다.

```bash
npm i -D playwright            # 또는 전역 playwright 사용
node test/server.js 8790 &     # 로컬 하네스 (HTML 의 API_URL 만 로컬로 치환)
node test/drive.js             # 운영자 조작 시나리오 33개
node test/offline.js           # 네트워크 끊김 → 큐 적재 → 복구 후 자동 전송
node test/survey.js            # 설문 4종 · 조각 전송 · 증정 코드 중복 차단
node test/book.js              # 예약 접수 · 정원 초과 차단 · 동시 접수 경합
node test/sns.js               # SNS 후기 · 사진 압축/업로드 · 드라이브 저장 · 집계 스냅샷
```

`drive.js` 와 `offline.js` 는 **빈 시트를 전제**로 단언합니다.
매출 단언이 어긋나면 대개 서버를 재시작하지 않고 재실행한 경우입니다.
`node test/server.js <새 포트>` 로 새 인스턴스를 띄우고 `BASE` 를 맞추세요.

크로미움 경로는 `/opt/pw-browsers/chromium-*/chrome-linux/chrome` 를 직접 지정합니다.
로컬 환경이 다르면 `executablePath` 를 지우고 playwright 기본 브라우저를 쓰면 됩니다.

## 고객 10명 시나리오 (sim10.js)

무작위 고객 10명이 홈페이지에서 회차를 고르고 → 예약하고 → 현장에서 체크인하고
→ 설문·SNS 후기를 남기고 → 운영자가 판매·방문을 기록하는 전 과정을 한 번에 돌립니다.
각 단계의 숫자가 서로 맞는지(예약 = 시트 행, 누른 판매 = 운영 화면 매출 = 집계 매출)
교차 검증하고, 모든 페이지의 스크립트 오류·요청 실패를 모아 보고합니다.

```bash
node test/server.js 8795 &
BASE=http://127.0.0.1:8795 node test/sim10.js        # 기본 시드
BASE=http://127.0.0.1:8795 SEED=777 node test/sim10.js   # 다른 시나리오
```

`SEED` 를 바꾸면 이름·프로그램·회차·도안·구매 여부가 전부 달라집니다.
같은 시드는 같은 시나리오를 재현하므로, 문제를 잡았을 때 그 시드로 다시 돌리면 됩니다.
**빈 시트를 전제로 단언**하므로 실행마다 서버를 새로 띄우세요.

## 담당자별 접수대 (desks.js)

`coloring.html`(컬러링 접수대)과 `gift.html`(증정 접수대) 두 화면을
예약 → 체험 시작 → 후기 작성 → 작품/증정품 전달까지 실제로 눌러가며 확인합니다.
휴대폰 뒷자리 표시, 후기 전에는 전달 버튼이 안 뜨는 것, 중복 지급 차단,
재고 차감, 판매 시트 기록까지 봅니다.

```bash
node test/server.js 8810 &
node test/desks.js
```

## 리허설 더미 (demo.js)

`demoSeed()` 로 더미를 넣고 → 두 접수대에서 실제로 눌러보고 →
`demoClear()` 로 지웠을 때 **재고까지 원래대로 돌아오는지** 확인합니다.

```bash
node test/server.js 8815 &
node test/demo.js
```

`NO_MOCK_ROSTER=1` 을 주면 목업 예약 명단(참가자1…)을 끕니다.
리허설 더미만 놓고 화면을 그대로 찍을 때 씁니다.

```bash
NO_MOCK_ROSTER=1 node test/server.js 8820 &
```

## 준비물 탭 (checklist_tab.js)

`setupChecklist()` 이 구글 시트에 체크박스 달린 준비물 탭을 만드는지,
계획서 항목이 빠지지 않았는지, 두 번 실행해도 체크해 둔 것이
날아가지 않는지 확인합니다.

```bash
node test/server.js 8860 &
node test/checklist_tab.js
```

## 예약 시점 도안 차감 (stock_on_book.js)

예약과 동시에 도안 재고가 빠지는지, 체크인에서 이중으로 빠지지 않는지,
현장에서 도안을 바꾸거나 노쇼일 때 제대로 되돌아오는지 확인합니다.
`syncSheetStock()` 이 틀어진 차감을 바로잡고 두 번 돌려도 같은지도 봅니다.

```bash
node test/server.js 8880 &
node test/stock_on_book.js
```
