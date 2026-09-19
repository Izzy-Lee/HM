/* 실제 HM 파일을 그대로 서빙하면서, Apps Script 백엔드만 로컬에서 흉내낸다.
   Code.gs 는 목업이 아니라 실제 파일을 그대로 실행한다. */
const http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm'), url = require('url');
const ROOT = '/home/user/HM';

/* ── Apps Script 런타임 목업 ── */
class Sheet {
  constructor(n){ this.name=n; this.data=[]; }
  getLastRow(){ return this.data.length; }
  getLastColumn(){ return this.data.reduce((a,r)=>Math.max(a,r.length),0); }
  appendRow(r){ this.data.push(r.slice()); }
  deleteRow(r){ this.data.splice(r-1, 1); return this; }
  setFrozenRows(){ return this; }
  setColumnWidth(){ return this; }
  setColumnWidths(){ return this; }
  setRowHeight(){ return this; }
  setTabColor(){ return this; }
  hideSheet(){ this.hidden=true; return this; }
  activate(){ return this; }
  getIndex(){ return 1; }
  clear(){ this.data=[]; return this; }
  autoResizeColumns(){ return this; }
  autoResizeColumn(){ return this; }
  getFormUrl(){ return null; }
  getRange(r,c,nr,nc){ const sh=this; nr=nr||1; nc=nc||1;
    return {
      getValues(){ const o=[]; for(let i=0;i<nr;i++){ const row=sh.data[r-1+i]||[]; const x=[];
        for(let j=0;j<nc;j++) x.push(row[c-1+j]===undefined?'':row[c-1+j]); o.push(x);} return o; },
      getValue(){ return (sh.data[r-1]||[])[c-1] ?? ''; },
      setValues(v){ for(let i=0;i<v.length;i++){ if(!sh.data[r-1+i]) sh.data[r-1+i]=[];
        for(let j=0;j<v[i].length;j++) sh.data[r-1+i][c-1+j]=v[i][j]; } return this; },
      setValue(v){ if(!sh.data[r-1]) sh.data[r-1]=[]; sh.data[r-1][c-1]=v; return this; },
      clearContent(){ for(let i=0;i<nr;i++){ const row=sh.data[r-1+i]; if(!row) continue;
        for(let j=0;j<nc;j++) row[c-1+j]=''; } return this; },
      setFontWeight(){return this;}, setBackground(){return this;},
      insertCheckboxes(){ for(let i=0;i<nr;i++){ if(!sh.data[r-1+i]) sh.data[r-1+i]=[];
        for(let j=0;j<nc;j++) if(sh.data[r-1+i][c-1+j]==='') sh.data[r-1+i][c-1+j]=false; } return this; },
      setFontColor(){return this;}, setFontSize(){return this;}, setWrap(){return this;},
      setHorizontalAlignment(){return this;}, setVerticalAlignment(){return this;},
      setBorder(){return this;}, merge(){return this;}
    };
  }
}
class SS {
  constructor(){ this.sheets={}; }
  getSheetByName(n){ return this.sheets[n]||null; }
  insertSheet(n){ return this.sheets[n]=new Sheet(n); }
  deleteSheet(sh){ delete this.sheets[sh.name]; return this; }
  getSheets(){ return Object.values(this.sheets); }
  getName(){ return '테스트 스프레드시트'; }
  getUrl(){ return 'https://docs.google.com/spreadsheets/d/TEST/edit'; }
  toast(){}
}
const ss = new SS();
const ctx = {
  SpreadsheetApp:{ getActiveSpreadsheet:()=>ss },
  ContentService:{ MimeType:{JSON:'application/json',JAVASCRIPT:'application/javascript'},
    createTextOutput:t=>({ _t:t,_m:'application/json',
      setMimeType(m){this._m=m;return this;}, getContent(){return this._t;}, getMime(){return this._m;} }) },
  LockService:{ getScriptLock:()=>({waitLock(){},releaseLock(){}}) },
  Utilities:{
    formatDate:(d,tz,f)=>{
      const iso=new Date(d).toISOString();
      if(f==='yyyyMMdd_HHmmss') return iso.slice(0,19).replace(/[-:T]/g,'').replace(/(\d{8})(\d{6})/,'$1_$2');
      if(f==='yyyyMMdd_HHmm')   return iso.slice(0,16).replace(/[-:T]/g,'').replace(/(\d{8})(\d{4})/,'$1_$2');
      return iso.slice(0,19).replace('T',' ');
    },
    base64Decode:(b64)=>Array.from(Buffer.from(b64,'base64')),
    newBlob:(data,type,name)=>({
      _bytes: Array.isArray(data)?data:null,
      _text: typeof data==='string'?data:null,
      getDataAsString:()=>Array.isArray(data)?Buffer.from(data).toString('utf8'):String(data),
      getName:()=>name||'blob'
    })
  },
  CacheService:{ getScriptCache:()=>({
    _m:(global.__cache = global.__cache || new Map()),
    get(k){ return this._m.has(k)? this._m.get(k) : null; },
    put(k,v){ this._m.set(k,v); },
    remove(k){ this._m.delete(k); }
  })},
  Logger:{ log:()=>{} }, console,

  /* 드라이브 목업 — 실제로 로컬 디렉터리에 파일을 쓴다 (검증용) */
  DriveApp: (()=>{
    const DRIVE = path.join(__dirname,'drive_mock');
    fs.mkdirSync(DRIVE,{recursive:true});
    const mk = dir => {
      fs.mkdirSync(dir,{recursive:true});
      return {
        _d:dir,
        getUrl:()=>'file://'+dir,
        getFoldersByName(n){ const d=path.join(dir,n); const has=fs.existsSync(d);
          let used=false; return { hasNext:()=>has&&!used, next:()=>{used=true;return mk(d);} }; },
        createFolder(n){ return mk(path.join(dir,n)); },
        createFile(blob){
          const f=path.join(dir,blob.getName());
          fs.writeFileSync(f, blob._bytes ? Buffer.from(blob._bytes) : blob._text);
          return { getUrl:()=>'file://'+f, getId:()=>blob.getName(), getName:()=>blob.getName(),
                   setSharing(){ return this; } };
        }
      };
    };
    const root = mk(DRIVE);
    return { getFoldersByName:n=>root.getFoldersByName(n), createFolder:n=>root.createFolder(n),
             Access:{ANYONE_WITH_LINK:'anyone'}, Permission:{VIEW:'view'} };
  })()
};
vm.createContext(ctx);

/* 실제 Apps Script 프로젝트와 같게 두 파일을 모두 로드한다.
   Code.gs 가 slot-capacity.gs 의 함수(getSlotAvailability, getSheet_ 등)를 쓰기 때문이다. */
vm.runInContext(fs.readFileSync(path.join(ROOT,'apps-script/slot-capacity.gs'),'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,'apps-script/Code.gs'),'utf8'), ctx);

/* 구글 폼이 만들어 둔 예약 응답 시트를 흉내낸다 — 헤더 이름만 맞으면 된다 */
const resv = ss.insertSheet('설문지 응답 시트1');
resv.appendRow(['타임스탬프','참여 프로그램','예약 시간','이름','연락처']);
/* CONFIG 는 const 라 전역 객체에 안 붙는다. 컨텍스트 안에서 직접 설정한다. */
vm.runInContext("CONFIG.SHEET_NAME = '설문지 응답 시트1'; CONFIG.NOTIFY_EMAIL = '';", ctx);

ctx.setupFieldSheets();

/* 예약 명단 목업 — roster 가 예약 시트를 못 읽을 때의 동작도 함께 본다 */
const RESERVATIONS = {};
'13:00 13:30 14:00 14:30 15:00 15:30 16:00 16:30 17:00 17:30 18:00'.split(' ').forEach((t,ti)=>{
  RESERVATIONS['컬러링 '+t] = [1,2,3,4,5,6].map(i=>'참가자'+(ti*6+i));
  RESERVATIONS['바인더 '+t] = [1,2,3,4].map(i=>'바인더'+(ti*4+i));
});
/* 리허설 화면을 그대로 찍을 때는 목업 명단을 끈다 (NO_MOCK_ROSTER=1) */
const MOCK_ROSTER = process.env.NO_MOCK_ROSTER !== '1';
const origRoster = ctx.buildRoster_;
ctx.buildRoster_ = function(slot){
  const out = origRoster(slot);
  const names = out.people.map(p=>p.name);
  if (MOCK_ROSTER) (RESERVATIONS[String(slot)]||[]).forEach(n=>{ if(names.indexOf(n)===-1) out.people.push({name:n,status:'',design:'',done:''}); });
  return out;
};

const MIME={'.html':'text/html; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.md':'text/plain; charset=utf-8'};
const PORT = Number(process.argv[2]||8787);

http.createServer((req,res)=>{
  const u = url.parse(req.url, true);
  if (u.pathname === '/_dump') {
    const sh = ss.getSheetByName(u.query.tab);
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
    return res.end(JSON.stringify(sh ? sh.data : null));
  }
  /* 테스트용 — 캐시를 통째로 날린다 (실서버에서 조각이 증발하는 상황 재현) */
  if (u.pathname === '/_cachewipe') {
    if (global.__cache) global.__cache.clear();
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end('{"ok":true}');
  }
  /* 테스트용 — 스크립트 함수를 이름으로 직접 실행한다 */
  if (u.pathname === '/_run') {
    let out;
    try { out = ctx[u.query.fn](); }
    catch(e){ res.writeHead(500); return res.end(String(e && e.stack || e)); }
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
    return res.end(JSON.stringify(out === undefined ? {ok:true} : out));
  }
  /* 테스트용 — 재고 탭에 임의 품목을 끼워 넣는다 (지난 행사 잔재 재현) */
  /* 테스트용 — 체크박스 한 칸을 체크한 상태로 만든다 */
  if (u.pathname === '/_tick') {
    const sh = ss.getSheetByName(u.query.tab);
    sh.data[Number(u.query.row)-1][0] = true;
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end('{"ok":true}');
  }
  /* 테스트용 — 재고 '차감' 을 임의 값으로 틀어놓는다 */
  if (u.pathname === '/_skew') {
    const sh = ss.getSheetByName(u.query.tab);
    const h = sh.data[0];
    const iU = h.indexOf('차감'), iT = h.indexOf('초기수량'), iA = h.indexOf('보정'), iR = h.indexOf('잔여');
    for (let r = 1; r < sh.data.length; r++) {
      if (String(sh.data[r][0]).trim() !== u.query.key) continue;
      sh.data[r][iU] = Number(u.query.used);
      sh.data[r][iR] = Number(sh.data[r][iT]) - Number(u.query.used) + (Number(sh.data[r][iA])||0);
      break;
    }
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end('{"ok":true}');
  }
  if (u.pathname === '/_inject_stock') {
    const sh = ss.getSheetByName('재고');
    const t = Number(u.query.total||0);
    sh.appendRow([u.query.key, t, 0, 0, t]);
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end('{"ok":true}');
  }
  if (u.pathname === '/exec') {
    let out;
    try { out = ctx.doGet({parameter:u.query}); }
    catch(e){ res.writeHead(500); return res.end(String(e)); }
    res.writeHead(200,{'Content-Type':out.getMime()});
    return res.end(out.getContent());
  }
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
  let body = fs.readFileSync(f);
  const ext = path.extname(f);
  if (ext === '.html') {
    // 실제 파일에서 API_URL 만 로컬 목업으로 돌린다. 나머지 코드는 손대지 않는다.
    body = body.toString('utf8').replace(
      /const API_URL = '[^']*'/g, "const API_URL = 'http://127.0.0.1:"+PORT+"/exec'");
  }
  res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'});
  res.end(body);
}).listen(PORT, '127.0.0.1', ()=>console.log('serving '+ROOT+' on http://127.0.0.1:'+PORT));
