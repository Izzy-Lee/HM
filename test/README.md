# 브라우저 E2E 테스트

실제 `staff.html` / `report.html` / `index.html` 을 크로미움에서 띄우고,
실제 `apps-script/Code.gs` 를 로컬에서 실행해 붙여 돌립니다.
스프레드시트만 메모리 목업이고, 화면과 백엔드 로직은 배포본과 같은 코드입니다.

```bash
npm i -D playwright            # 또는 전역 playwright 사용
node test/server.js 8790 &     # 로컬 하네스 (HTML 의 API_URL 만 로컬로 치환)
node test/drive.js             # 운영자 조작 시나리오 33개
node test/offline.js           # 네트워크 끊김 → 큐 적재 → 복구 후 자동 전송
node test/survey.js            # 설문 4종 · 조각 전송 · 증정 코드 중복 차단
```

`drive.js` 와 `offline.js` 는 **빈 시트를 전제**로 단언합니다.
매출 단언이 어긋나면 대개 서버를 재시작하지 않고 재실행한 경우입니다.
`node test/server.js <새 포트>` 로 새 인스턴스를 띄우고 `BASE` 를 맞추세요.

크로미움 경로는 `/opt/pw-browsers/chromium-*/chrome-linux/chrome` 를 직접 지정합니다.
로컬 환경이 다르면 `executablePath` 를 지우고 playwright 기본 브라우저를 쓰면 됩니다.
