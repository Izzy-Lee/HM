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
  setFrozenRows(){ return this; }
  getFormUrl(){ return null; }
  getRange(r,c,nr,nc){ const sh=this; nr=nr||1; nc=nc||1;
    return {
      getValues(){ const o=[]; for(let i=0;i<nr;i++){ const row=sh.data[r-1+i]||[]; const x=[];
        for(let j=0;j<nc;j++) x.push(row[c-1+j]===undefined?'':row[c-1+j]); o.push(x);} return o; },
      getValue(){ return (sh.data[r-1]||[])[c-1] ?? ''; },
      setValues(v){ for(let i=0;i<v.length;i++){ if(!sh.data[r-1+i]) sh.data[r-1+i]=[];
        for(let j=0;j<v[i].length;j++) sh.data[r-1+i][c-1+j]=v[i][j]; } return this; },
      setValue(v){ if(!sh.data[r-1]) sh.data[r-1]=[]; sh.data[r-1][c-1]=v; return this; },
      setFontWeight(){return this;}, setBackground(){return this;}
    };
  }
}
class SS {
  constructor(){ this.sheets={}; }
  getSheetByName(n){ return this.sheets[n]||null; }
  insertSheet(n){ return this.sheets[n]=new Sheet(n); }
  getSheets(){ return Object.values(this.sheets); }
  toast(){}
}
const ss = new SS();
const ctx = {
  SpreadsheetApp:{ getActiveSpreadsheet:()=>ss },
  ContentService:{ MimeType:{JSON:'application/json',JAVASCRIPT:'application/javascript'},
    createTextOutput:t=>({ _t:t,_m:'application/json',
      setMimeType(m){this._m=m;return this;}, getContent(){return this._t;}, getMime(){return this._m;} }) },
  LockService:{ getScriptLock:()=>({waitLock(){},releaseLock(){}}) },
  Utilities:{ formatDate:(d)=>new Date(d).toISOString().slice(0,19).replace('T',' ') },
  Logger:{ log:()=>{} }, console
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,'apps-script/Code.gs'),'utf8'), ctx);
ctx.setupFieldSheets();

/* 예약 명단 목업 — roster 가 예약 시트를 못 읽을 때의 동작도 함께 본다 */
const RESERVATIONS = {};
'13:30 14:00 14:30 15:00'.split(' ').forEach((t,ti)=>{
  RESERVATIONS['컬러링 '+t] = [1,2,3,4,5,6].map(i=>'참가자'+(ti*6+i));
  RESERVATIONS['바인더 '+t] = [1,2,3,4].map(i=>'바인더'+(ti*4+i));
});
const origRoster = ctx.buildRoster_;
ctx.buildRoster_ = function(slot){
  const out = origRoster(slot);
  const names = out.people.map(p=>p.name);
  (RESERVATIONS[String(slot)]||[]).forEach(n=>{ if(names.indexOf(n)===-1) out.people.push({name:n,status:'',design:'',done:''}); });
  return out;
};

const MIME={'.html':'text/html; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.md':'text/plain; charset=utf-8'};
const PORT = Number(process.argv[2]||8787);

http.createServer((req,res)=>{
  const u = url.parse(req.url, true);
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
