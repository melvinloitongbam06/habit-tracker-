'use strict';
/* ---------- helpers ---------- */
const KEY='ht2',OLD='ht1',LOCAL_DONE='ht2_localdone'; /* KEY/OLD: the earlier single-browser versions */
const IC={water:'M12 3c4 5 6 7 6 10a6 6 0 0 1-12 0c0-3 2-5 6-10z',book:'M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z',bolt:'M13 3L5 14h6l-1 7 8-11h-6z',study:'M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5',mind:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 14c2 2 6 2 8 0',moon:'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z',heart:'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z',home:'M4 11l8-7 8 7v9H4z',list:'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',cal:'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',chart:'M5 20V10M12 20V4M19 20v-7',user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',ck:'M4 12l5 5L20 6',edit:'M4 20h4L19 9l-4-4L4 16z',note:'M5 4h14v16H5zM9 9h6M9 13h6',archive:'M4 5h16v4H4zM6 9v10h12V9M10 13h4',trash:'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',undo:'M4 12a8 8 0 1 0 3-6M4 4v5h5',bell:'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21a2 2 0 0 0 4 0',flame:'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z',connect:'M8 12h8M12 8v8M4 7h4v4H4zM16 13h4v4h-4zM7 11v2a4 4 0 0 0 4 4h1M17 13v-2a4 4 0 0 0-4-4h-1'};
const PICK=['water','book','bolt','study','mind','moon','heart'];
const ic=n=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${IC[n]||IC.bolt}"/></svg>`;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const KD=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const P=k=>{const a=k.split('-').map(Number);return new Date(a[0],a[1]-1,a[2])};
const add=(k,n)=>{const d=P(k);d.setDate(d.getDate()+n);return KD(d)};
let authoritativeToday=null;
const today=()=>authoritativeToday||KD(new Date());
function acceptServerToday(value){
  if(validDate(value)){
    const changed=!!authoritativeToday&&authoritativeToday!==value;
    if(changed)ui.sel=null;
    authoritativeToday=value
    return changed
  }}
const dow=k=>(P(k).getDay()+6)%7; /* Mon=0 */
const DN=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DL=['Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays','Sundays'];
const validDate=k=>typeof k==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(k)&&KD(P(k))===k;
const fmt=(k,o)=>P(k).toLocaleDateString('en',o);
const newId=()=>'h'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const mins=hm=>{const a=hm.split(':').map(Number);return a[0]*60+a[1]};

/* ---------- state ---------- */
let S,loadMsg='',saveFailed=false,syncMsg='';
const ui={tab:'home',sel:null,filter:'All',month:null,sheet:null,anim:true,bars:{},ringPrev:0,alerts:[],boot:'loading',bootErr:'',authMode:'login',authErr:'',authUser:'',busy:false,user:null,localOffer:false};
const snooze={};
const calm=()=>!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
const fmtTime=hm=>{const a=hm.split(':').map(Number),d=new Date();d.setHours(a[0],a[1],0,0);return d.toLocaleTimeString('en',{hour:'numeric',minute:'2-digit'})};
const DONE_MSGS=['All done for today. Nicely done!','Everything checked off. Go enjoy your day.','Clean sweep! Small steps add up.'];
const notified=new Set();
const blank=()=>({v:2,name:'',habits:[],logs:{},prefs:{theme:'auto',week:'mon',remind:false,inapp:true,chime:false},dismiss:{},xp:{total:0,level:1,rank:'Novice',xp_in_level:0,xp_to_next:100,next_level_xp:100,weekly:{done:0,target:0,streak:0,next_bonus:25}}});

function normalize(raw){
  const d=raw&&raw.data?raw.data:raw;
  if(!d||typeof d!=='object'||!Array.isArray(d.habits))throw new Error('Not a habit tracker file');
  const s=blank();
  s.name=typeof d.name==='string'?d.name.trim().slice(0,30):'';
  const p=d.prefs&&typeof d.prefs==='object'?d.prefs:{};
  s.prefs.theme=['auto','light','dark'].includes(p.theme)?p.theme:'auto';
  s.prefs.week=p.week==='sun'?'sun':'mon';
  s.prefs.inapp=p.inapp!==false;s.prefs.chime=!!p.chime;
  const seen=new Set();
  d.habits.slice(0,200).forEach(h=>{
    if(!h||typeof h!=='object')return;
    const name=String(h.name==null?'':h.name).trim().slice(0,40);if(!name)return;
    const oid=h.id;
    let id=typeof oid==='string'&&/^[\w-]{1,40}$/.test(oid)&&!seen.has(oid)?oid:newId()+seen.size;seen.add(id);
    let type=['check','count','duration'].includes(h.type)?h.type:'check';
    let goal=Math.round(Number(h.goal));if(!(goal>=1))goal=1;goal=Math.min(goal,100000);
    if(type==='check')goal=1;
    const legacyIncrement=goal>=100?10:goal>=20?5:1;
    const rawIncrement=Number(h.increment);
    const increment=Number.isInteger(rawIncrement)&&rawIncrement>=1?Math.min(rawIncrement,100000):legacyIncrement;
    const freq=['daily','days','weekly'].includes(h.freq)?h.freq:'daily';
    let days=Array.isArray(h.days)?[...new Set(h.days.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=6))].sort():[];
    if(!days.length)days=freq==='days'?[0,1,2,3,4]:[0,1,2,3,4,5,6];
    let wk=Math.round(Number(h.wk));if(!(wk>=1&&wk<=7))wk=3;
    const remind=typeof h.remind==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(h.remind)?h.remind:'';
    const hab={id,name,icon:IC[h.icon]?h.icon:'bolt',type,goal,unit:type!=='check'?String(h.unit||(type==='duration'?'min':'')).trim().slice(0,20):'',increment:type==='count'?increment:1,freq,days,wk,remind,start:validDate(h.start)?h.start:today(),archived:!!h.archived,demo:!!h.demo};
    s.habits.push(hab);
    const src=d.logs&&typeof d.logs==='object'?d.logs[oid]:null,L={};
    if(src&&typeof src==='object'){
      Object.keys(src).slice(0,5000).forEach(k=>{
        const e=src[k];if(!validDate(k)||!e||typeof e!=='object')return;
        const v=Number(e.v);if(!isFinite(v)||v<0||v>1e6)return;
        let g=Math.round(Number(e.g));if(!(g>=1))g=goal;g=Math.min(g,100000);
        const note=typeof e.note==='string'?e.note.trim().slice(0,200):'';
        const durationSeconds=Math.max(0,Math.min(100000000,Math.floor(Number(e.duration_seconds)||0)));
        const sessions=Array.isArray(e.timer_sessions)?e.timer_sessions.map(Number).filter(x=>Number.isInteger(x)&&x>=0&&x<=100000000).slice(0,1000):[];
        const started=typeof e.timer_started_at==='string'&&Number.isFinite(Date.parse(e.timer_started_at))?e.timer_started_at:null;
        if(v>0||note||durationSeconds||sessions.length||started){
          const o={v:type==='check'?Math.min(v,1):Math.min(v,1e6),g};
          if(note)o.note=note;
          if(durationSeconds||sessions.length||started){o.duration_seconds=durationSeconds;o.timer_sessions=sessions}
          if(started)o.timer_started_at=started;
          L[k]=o
        }
      });
    }
    s.logs[id]=L;
  });
  return s;
}
function migrate(o){
  if(!o||!Array.isArray(o.h))return null;
  const s=blank();
  s.prefs.theme=['auto','light','dark'].includes(o.theme)?o.theme:'auto';
  s.prefs.week=o.pref&&o.pref.mon?'sun':'mon'; /* old key "mon" was the "Sunday" toggle */
  const seedNames=['Drink Water','Read 30 Minutes','Exercise','Study','Meditation'],t=today();
  o.h.forEach((h,i)=>{
    if(!h||typeof h!=='object')return;
    const m=String(h.target||'').match(/^([\d.]+)\s*(.*)$/);
    let g=m?Math.round(parseFloat(m[1])):1;if(!(g>=1))g=1;g=Math.min(g,100000);
    const type=g>=2?'count':'check';
    const done=h.done&&typeof h.done==='object'?h.done:{},lg=h.log&&typeof h.log==='object'?h.log:{};
    const keys=[...new Set(Object.keys(done).concat(Object.keys(lg)))].filter(k=>validDate(k)&&k<=t).sort();
    const id='m'+i+'-'+Date.now().toString(36);
    const wkly=h.freq==='Weekly';
    s.habits.push({id,name:String(h.name||'Habit').trim().slice(0,40)||'Habit',icon:IC[h.icon]?h.icon:'bolt',type,goal:type==='count'?g:1,unit:type==='count'?(m&&m[2]?m[2].trim().slice(0,20):''):'',increment:type==='count'?(g>=100?10:g>=20?5:1):1,freq:wkly?'weekly':'daily',days:[0,1,2,3,4,5,6],wk:1,remind:'',start:keys[0]||t,archived:false,demo:o.h.length===5&&h.id===i&&seedNames[i]===h.name});
    const L={};
    keys.forEach(k=>{let v=lg[k]!=null?Number(lg[k]):(done[k]?(type==='count'?g:1):0);if(!isFinite(v)||v<=0)return;L[k]={v:Math.min(v,type==='count'?g:1),g:type==='count'?g:1}});
    s.logs[id]=L;
  });
  return s;
}
/* ---------- server data ---------- */
function cleanDismiss(d){
  const o={};
  if(d&&typeof d==='object')Object.keys(d).slice(0,200).forEach(k=>{if(/^[\w-]{1,40}$/.test(k)&&validDate(d[k]))o[k]=d[k]});
  return o}
function fromServer(st){
  const s=normalize({name:st.profile.name,prefs:st.profile,habits:st.habits,logs:st.logs});
  s.prefs.remind=!!st.profile.remind;
  s.dismiss=cleanDismiss(st.profile.dismiss);
  s.xp=st.xp||blank().xp;
  return s}
/* habits saved in this browser by the earlier single-file version, offered once after sign-in */
function localData(){
  try{
    if(localStorage.getItem(LOCAL_DONE))return null;
    const raw=localStorage.getItem(KEY);
    if(raw){const n=normalize(JSON.parse(raw));return n.habits.length?n:null}
    const old=localStorage.getItem(OLD);
    if(old){const m=migrate(JSON.parse(old));return m&&m.habits.length?m:null}
  }catch(e){}
  return null}
/* every change in the app calls save(); Sync (api.js) works out what changed and sends it */
function save(){Sync.touch();return true}
function setSyncFail(v,msg){
  const m=msg||'';
  if(saveFailed===v&&syncMsg===m)return;
  saveFailed=v;syncMsg=m;
  if(ui.boot==='ready')render()}
S=blank();

/* ---------- sign-in, loading and sign-out ---------- */
function authView(){
  const reg=ui.authMode==='register';
  return `<div class="auth"><div class="c hero"><h1 tabindex="-1">${reg?'Create your account':'Welcome back'}</h1><p class="m" style="font-size:14px;line-height:1.5;margin:0 0 8px">${reg?'Your habits are saved to your account and available on any device.':'Sign in to see your habits.'}</p><form data-f="auth" novalidate style="text-align:left"><label for="au">Username</label><input id="au" name="username" maxlength="30" value="${esc(ui.authUser)}" autocomplete="username" autocapitalize="none" spellcheck="false" data-first><label for="ap">Password</label><input id="ap" name="password" type="password" autocomplete="${reg?'new-password':'current-password'}"${reg?' aria-describedby="ah"':''}>${reg?'<div class="m" id="ah" style="margin-top:6px">At least 8 characters. Avoid common passwords.</div>':''}<div class="er" id="aer" role="alert">${esc(ui.authErr)}</div><button class="btn" style="margin-top:8px"${ui.busy?' disabled':''}>${ui.busy?'One moment…':reg?'Create account':'Sign in'}</button></form><div class="act" style="justify-content:center"><button class="sm" type="button" data-a="auth-mode">${reg?'I already have an account':'Create an account'}</button></div></div></div>`}
const BOOT={
  loading:()=>`<div class="auth"><div class="c hero" role="status"><h1 tabindex="-1">Habit Tracker</h1><p class="m">Loading your habits…</p></div></div>`,
  error:()=>`<div class="auth"><div class="c hero" role="alert"><h1 tabindex="-1">Can’t reach the server</h1><p class="m" style="line-height:1.5">${esc(ui.bootErr)}</p><div class="act" style="justify-content:center"><button class="btn" data-a="retry-boot">Try again</button></div></div></div>`,
  auth:authView};
async function authSubmit(f){
  if(ui.busy)return;
  const fd=new FormData(f),u=String(fd.get('username')||'').trim(),p=String(fd.get('password')||'');
  ui.authUser=u;
  if(!u||!p){ui.authErr='Enter a username and a password.';render();return}
  ui.busy=true;ui.authErr='';render();
  try{
    await (ui.authMode==='register'?Api.register(u,p):Api.login(u,p));
    await enterApp();
  }catch(e){
    ui.authErr=e.offline?'Can’t reach the server. Check your connection and try again.':e.message;
    ui.busy=false;render();
    setTimeout(()=>{const el=$(ui.authUser?'ap':'au');if(el)el.focus()},0);
    return}
  ui.busy=false}
async function enterApp(){
  const st=await Api.state();
  acceptServerToday(st.today);
  S=fromServer(st);ui.user=st.user.username;Sync.reset();
  Object.assign(ui,{boot:'ready',tab:'home',sel:null,filter:'All',month:null,anim:true,authErr:'',authUser:'',busy:false});
  ui.localOffer=!S.habits.length&&!!localData();
  setSyncFail(false);theme();render();
  if(typeof coachFirstRun==='function')coachFirstRun()}
function resetSession(msg){
  S=blank();Sync.snap=null;clearTimeout(Sync.timer);clearTimeout(Sync.retryT);
  Object.assign(ui,{boot:'auth',authMode:'login',authErr:msg||'',authUser:'',user:null,localOffer:false,sheet:null});
  saveFailed=false;syncMsg='';
  try{if(typeof coachClose==='function')coachClose(false)}catch(e){}
  const sh=$('sh');if(sh&&sh.classList.contains('o')){sh.classList.remove('o');$('app').inert=false}
  theme();render()}
function sessionLost(){resetSession('Your session expired. Sign in again to continue.')}
async function doLogout(){
  if(Sync.snap){try{await Sync.flush()}catch(e){}}
  if(saveFailed){toast('Some changes aren’t saved yet. Try again in a moment.');return}
  try{await Api.logout()}catch(e){}
  resetSession('')}


/* ---------- habit logic ---------- */
const active=()=>S.habits.filter(h=>!h.archived);
const hasNonTodayLogs=id=>Object.keys(S.logs[id]||{}).some(day=>day!==today());
const getLog=(h,k)=>(S.logs[h.id]||{})[k];
const goalFor=(h,k)=>{const e=getLog(h,k);return e&&e.g?e.g:h.goal};
const val=(h,k)=>{const e=getLog(h,k);return e?e.v:0};
const trackedSeconds=(h,k)=>{
  const e=getLog(h,k)||{},started=e.timer_started_at?Date.parse(e.timer_started_at):NaN;
  return Math.max(0,Number(e.duration_seconds)||0)+(Number.isFinite(started)?Math.max(0,Math.floor((Date.now()-started)/1000)):0)};
const fmtDuration=seconds=>{
  const n=Math.max(0,Math.floor(seconds)),hours=Math.floor(n/3600),minutes=Math.floor(n%3600/60),secs=n%60;
  return hours?pad(hours)+':'+pad(minutes)+':'+pad(secs):pad(minutes)+':'+pad(secs)};
const isDone=(h,k)=>{
  const e=getLog(h,k);if(!e)return false;
  if(h.type==='duration')return trackedSeconds(h,k)>=(e.g||h.goal)*60;
  return e.v>0&&e.v>=(e.g||h.goal)};
const activityGoalDone=(h,k)=>{
  if(k>today()||k<h.start)return false;
  const e=getLog(h,k);if(!e)return false;
  return h.type==='duration'
    ?trackedSeconds(h,k)>=(e.g||h.goal)*60
    :e.v>=(e.g||h.goal)};
const stepSize=h=>h.increment||1;
const isSched=(h,k)=>h.freq==='daily'||(h.freq==='days'&&h.days.includes(dow(k)));
const wsOff=k=>{const g=P(k).getDay();return S.prefs.week==='sun'?g:(g+6)%7};
const weekKeys=k=>{const s=add(k,-wsOff(k));return[...Array(7)].map((_,i)=>add(s,i))};
const weekCount=(h,k)=>weekKeys(k).filter(x=>isDone(h,x)).length;
const due=(h,k)=>{
  if(h.archived||k<h.start||k>today())return false;
  if(isDone(h,k))return true;
  if(h.freq==='weekly')return k===today()&&weekCount(h,k)<h.wk;
  return isSched(h,k)};
const visible=(h,k)=>!h.archived&&k>=h.start&&(h.freq==='weekly'||isSched(h,k)||isDone(h,k));
function dayCount(k){const ds=active().filter(h=>due(h,k));return{done:ds.filter(h=>isDone(h,k)).length,total:ds.length}}
function rangeStats(keys){
  let done=0,sched=0;const t=today();
  keys.forEach(k=>{if(k>t)return;active().forEach(h=>{
    if(k<h.start)return;const d=isDone(h,k);
    if(h.freq==='weekly'){if(d){done++;sched++}}
    else if(isSched(h,k)||d){if(d){done++;sched++}else if(k!==t)sched++}})});
  return{done,sched,pct:sched?Math.round(done/sched*100):null}}
function streakOf(h){
  const t=today();
  if(h.freq==='weekly'){let n=0,k=t;for(let i=0;i<150;i++){if(weekKeys(k)[6]<h.start)break;if(weekCount(h,k)>=h.wk)n++;else if(i>0)break;k=add(k,-7)}return{n,unit:'week'}}
  let n=0;
  for(let i=0;i<1500;i++){const k=add(t,-i);if(k<h.start)break;
    if(isDone(h,k))n++;else if(isSched(h,k)&&i>0)break}
  return{n,unit:'day'}}
function bestOf(h){
  const t=today(),lim=add(t,-730),from=h.start>lim?h.start:lim;let b=0,c=0;
  if(h.freq==='weekly'){
    for(let k=add(from,-wsOff(from));k<=t;k=add(k,7)){const wkk=weekKeys(k),met=wkk.filter(x=>isDone(h,x)).length>=h.wk;
      if(met){c++;b=Math.max(b,c)}else if(wkk[6]<t)c=0}
    return{n:Math.max(b,streakOf(h).n),unit:'week'}}
  for(let k=from;k<=t;k=add(k,1)){if(isDone(h,k)){c++;b=Math.max(b,c)}else if(isSched(h,k)&&k<t)c=0}
  return{n:Math.max(b,streakOf(h).n),unit:'day'}}
function rate(h,N){
  const t=today();let done=0,sched=0,span=0;
  for(let i=0;i<N;i++){const k=add(t,-i);if(k<h.start)continue;span++;const d=isDone(h,k);
    if(h.freq==='weekly'){if(d)done++}
    else if(isSched(h,k)||d){if(d){done++;sched++}else if(k!==t)sched++}}
  if(h.freq==='weekly'){sched=Math.max(1,Math.round(h.wk*span/7));done=Math.min(done,sched)}
  return{done,sched,pct:sched>=3?Math.round(done/sched*100):null}}
function schedLabel(h){
  if(h.freq==='weekly')return h.wk+(h.wk===1?' time':' times')+' per week';
  if(h.freq==='daily')return'Every day';
  const d=h.days.join();if(d==='0,1,2,3,4')return'Weekdays';if(d==='5,6')return'Weekends';
  return h.days.map(i=>DN[i]).join(', ')}
function setVal(h,k,v){
  const L=S.logs[h.id]=S.logs[h.id]||{};
  const e=L[k]||{v:0,g:h.goal};
  e.v=Math.max(0,Math.min(h.type==='check'?1:1e6,v));L[k]=e;
  if(e.v===0&&!e.note&&!e.duration_seconds&&!e.timer_started_at)delete L[k]}

/* ---------- toast / sheet ---------- */
let tt;
function toast(t){const e=$('toast');e.textContent=t;e.className='o';clearTimeout(tt);tt=setTimeout(()=>e.className='',2600)}
const keyOf=el=>el&&el.dataset&&el.dataset.a?{a:el.dataset.a,id:el.dataset.id,k:el.dataset.k,t:el.dataset.t}:null;
const selOf=q=>{let s='[data-a="'+CSS.escape(q.a)+'"]';if(q.id!==undefined)s+='[data-id="'+CSS.escape(q.id)+'"]';if(q.k!==undefined)s+='[data-k="'+CSS.escape(q.k)+'"]';if(q.t!==undefined)s+='[data-t="'+CSS.escape(q.t)+'"]';return s};
let opener=null,openerKey=null;
function openSheet(html,sheet){
  const sh=$('sh'),shc=$('shc'),was=sh.classList.contains('o');
  const act=document.activeElement,key=was&&shc.contains(act)?keyOf(act):null;
  if(!was){opener=act;openerKey=keyOf(act)}
  ui.sheet=sheet;shc.innerHTML=html;sh.classList.add('o');$('app').inert=true;animateBars();
  let f=key&&shc.querySelector(selOf(key));
  if(!f)f=shc.querySelector('[data-first]')||shc.querySelector('input:not([type=hidden]),button,select,textarea');
  if(f)f.focus({preventScroll:true})}
function closeSheet(){
  const sh=$('sh');if(!sh.classList.contains('o'))return;
  ui.sheet=null;sh.classList.remove('o');$('app').inert=false;render();
  let f=openerKey&&$('app').querySelector(selOf(openerKey));
  if(!f&&opener&&opener!==document.body&&document.body.contains(opener)&&opener.focus)f=opener;
  if(!f)f=document.querySelector('#v h1');
  if(f)f.focus({preventScroll:true})}
function refreshSheet(){if(ui.sheet&&ui.sheet.type==='day')openSheet(dayHTML(ui.sheet.k),ui.sheet)}
function refresh(){render();refreshSheet()}
$('sh').addEventListener('click',e=>{if(e.target.id==='sh')closeSheet()});
document.addEventListener('keydown',e=>{
  const sh=$('sh');if(!sh.classList.contains('o'))return;
  if(e.key==='Escape'){e.preventDefault();closeSheet();return}
  if(e.key==='Tab'){const f=[...$('shc').querySelectorAll('button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(x=>x.offsetParent!==null||x===document.activeElement);
    if(!f.length)return;const a=f[0],z=f[f.length-1];
    if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}
    else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}
    else if(!$('shc').contains(document.activeElement)){e.preventDefault();a.focus()}}});
function confirmSheet(o){
  pending=o.action;
  openSheet(`<h1 id="sht" tabindex="-1" data-first>${esc(o.title)}</h1><p style="line-height:1.5">${o.body}</p><div class="g" style="margin-top:16px">${o.extra||''}<button class="btn ${o.danger?'dng':''}" data-a="confirm-yes">${esc(o.ok)}</button><button class="btn sec" data-a="close">Cancel</button></div>`,{type:'confirm'})}
let pending=null;
let connectCode='',healthConnectStatus=null,healthConnectLoading=false,healthConnectError='';
function healthLocalContext(){
  const d=new Date(),date=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  return {date,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',offset:-d.getTimezoneOffset()}
}
function connectSheet(){
  const code=connectCode?`<div class="connect-code-wrap"><div class="m">Temporary pairing code · expires in 10 minutes</div><code class="connect-code" aria-label="Pairing code ${esc(connectCode)}">${esc(connectCode)}</code><div class="m">Enter this code in the Habit Tracker Android companion app.</div><div class="g g2 connect-code-actions"><button class="sm" data-a="connect-copy">${ic('connect')}Copy code</button><button class="sm" data-a="connect-generate">${ic('undo')}New code</button></div></div>`:'';
  const state=healthConnectLoading?'<div class="connect-preview"><b>Checking connection</b><span>Please wait…</span></div>':healthConnectError?`<div class="connect-preview" role="alert"><b>Connection status unavailable</b><span>${esc(healthConnectError)}</span></div><button class="sm" data-a="connect-refresh">Try again</button>`:healthConnectStatus?.connected?`<div class="connect-preview"><b>Health Connect is connected</b><span>${esc(healthConnectStatus.device_name||'Android device')}${healthConnectStatus.steps==null?' · No step sync today':' · '+Number(healthConnectStatus.steps).toLocaleString()+' steps today'}${healthConnectStatus.last_synced_at?' · Last sync '+esc(new Date(healthConnectStatus.last_synced_at).toLocaleString()):''}</span></div><div class="g g2"><button class="sm" data-a="connect-refresh">Refresh status</button><button class="sm" data-a="connect-disconnect">Disconnect</button></div>`:'<div class="connect-preview"><b>Read-only steps import</b><span>Connect an Android device running the companion app. Today’s steps are shown here separately and never change your habit progress.</span></div>';
  openSheet(`<h1 id="sht" tabindex="-1" data-first>Connect Health Connect</h1><p class="connect-intro">Import today’s step count from Health Connect on Android. Google Fit data can be included when it is available in Health Connect.</p>${state}${code}${healthConnectStatus?.connected?'':`${connectCode?'':'<button class="btn connect-generate" data-a="connect-generate">Create pairing code</button>'}`}<button class="btn sec" data-a="close">Close</button>`,{type:'health-connect'});
  if(!healthConnectStatus&&!healthConnectLoading&&!healthConnectError)refreshHealthConnect()
}
async function refreshHealthConnect(){
  healthConnectLoading=true;connectSheet();
  try{const c=healthLocalContext();healthConnectStatus=await Api.healthConnectStatus(c.date,c.timeZone,c.offset);if(healthConnectStatus.connected)connectCode='';healthConnectError=''}
  catch(e){healthConnectError=e.message}
  finally{healthConnectLoading=false;if(ui.sheet?.type==='health-connect')connectSheet()}
}

/* ---------- views ---------- */
function card(h,k,mode){
  const g=goalFor(h,k),v=val(h,k),done=isDone(h,k),cnt=h.type==='count',dur=h.type==='duration',e=getLog(h,k)||{};
  const readOnly=k!==today();
  const wkp=h.freq==='weekly'?weekCount(h,k):0,st=streakOf(h),bits=[];
  if(activityGoalDone(h,k))bits.push('Goal reward · 10 XP');
  if(cnt)bits.push(`${v} / ${g}${h.unit?' '+esc(h.unit):''}`);
  else if(dur)bits.push(`${g} min target`);
  else bits.push(done?'Done':'Not done yet');
  if(h.freq==='weekly')bits.push(`${wkp} of ${h.wk} this week`);
  if(st.n>0)bits.push(`${st.n}-${st.unit} streak`);
  const seconds=dur?trackedSeconds(h,k):0,target=dur?g*60:0;
  const pct=dur?Math.min(100,Math.round(seconds/target*100)):cnt?Math.min(100,Math.round(v/g*100)):(h.freq==='weekly'?Math.min(100,Math.round(wkp/h.wk*100)):null);
  const sz=stepSize(h),n=esc(h.name),activeTimer=!!e.timer_started_at;
  const progressLabel=dur?`${fmtDuration(seconds)} of ${fmtDuration(target)} tracked`:cnt?`${v} of ${g}${h.unit?' '+esc(h.unit):''}`:`${wkp} of ${h.wk} weekly check-ins`;
  const progress=pct!==null?`<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${n}: ${progressLabel}" aria-label="${n} progress"><i ${dur?`data-timer-bar="${h.id}|${k}"`:`data-bk="${h.id}|${k}" data-w="${pct}"`} style="width:${ui.bars[h.id+'|'+k]||pct}%"></i></div>`:'';
  const tracker=dur?`<div class="timer-readout"><strong ${activeTimer&&!readOnly?`data-timer-elapsed="${h.id}|${k}"`:''}>${fmtDuration(seconds)}</strong><span class="m">of ${fmtDuration(target)} target</span><span class="m"${activeTimer&&!readOnly?` data-timer-remaining="${h.id}|${k}"`:''}>${fmtDuration(Math.max(0,target-seconds))} ${seconds>=target?'completed':'remaining'} · ${(e.timer_sessions||[]).length} session${(e.timer_sessions||[]).length===1?'':'s'} on ${k===today()?'today':fmt(k,{month:'short',day:'numeric'})}</span></div>${readOnly?'':`<div class="act timer-controls"><button class="sm primary-action" data-a="timer-action" data-id="${h.id}" data-k="${k}" data-t="${activeTimer?'pause':'start'}" aria-label="${activeTimer?'Pause':'Start or resume'} ${n} timer">${activeTimer?'Pause':seconds?'Resume':'Start'}</button>${activeTimer?`<button class="sm" data-a="timer-action" data-id="${h.id}" data-k="${k}" data-t="stop" aria-label="Stop ${n} timer">Stop</button>`:''}<button class="sm" data-a="timer-action" data-id="${h.id}" data-k="${k}" data-t="reset" aria-label="Reset today’s ${n} timer">Reset</button></div>`}`
    :cnt?`<div class="act count-controls"><button class="sm" data-a="step" data-id="${h.id}" data-k="${k}" data-t="-1" aria-label="Remove ${sz} ${esc(h.unit)} from ${n}">−${sz}</button><button class="sm" data-a="step" data-id="${h.id}" data-k="${k}" data-t="1" aria-label="Add ${sz} ${esc(h.unit)} to ${n}">+${sz} ${esc(h.unit)}</button><label class="sr" for="qty-${h.id}-${k}">Quantity to add to ${n}</label><input class="qty-input" id="qty-${h.id}-${k}" type="number" min="1" step="1" placeholder="Add amount"><button class="sm" data-a="manual-step" data-id="${h.id}" data-k="${k}" aria-label="Add entered amount to ${n}">Add amount</button></div>`:'';
  return `<div class="c hb ${done?'on':''}"><div class="row"><div class="ic">${ic(h.icon)}</div><div class="grow"><b>${n}</b>${h.demo?'<span class="tag">Demo</span>':''}<div class="m">${bits.join(' · ')}</div></div>${dur||readOnly?'':`<button class="ck" data-a="tg" data-id="${h.id}" data-k="${k}" aria-pressed="${done}" aria-label="${n}: completed">${ic('ck')}</button>`}</div>${progress}${dur?tracker:''}${e.note?`<div class="nt">“${esc(e.note)}”</div>`:''}<div class="act">${readOnly?'<span class="m">Progress for this date is read-only</span>':!dur&&!cnt?`<button class="sm" data-a="tg" data-id="${h.id}" data-k="${k}" aria-label="Mark ${n} ${done?'not done':'done'}">${ic('ck')}${done?'Undo':'Mark done'}</button>`:''}${!readOnly?`<button class="sm" data-a="note" data-id="${h.id}" data-k="${k}" aria-label="${e.note?'Edit note':'Add note'} for ${n}">${ic('note')}${e.note?'Note':'Add note'}</button>${mode!=='day'?`<button class="sm" data-a="rem" data-id="${h.id}" aria-label="${h.remind?'Reminder at '+fmtTime(h.remind)+' for '+n+'. Change':'Add a reminder for '+n}">${ic('bell')}${h.remind?fmtTime(h.remind):'Remind me'}</button><button class="sm" data-a="edit" data-id="${h.id}" aria-label="Edit ${n}">${ic('edit')}Edit</button>`:''}`:''}</div>${cnt&&!readOnly?tracker:''}</div>`}
function recovery(){
  const t=today();if(ui.sel&&ui.sel!==t)return'';const out=[];
  active().forEach(h=>{
    if(h.freq==='weekly'||h.start>=t||isDone(h,t)||S.dismiss[h.id]===t||!isSched(h,t))return;
    let miss=0,seen=false;
    for(let i=1;i<60;i++){const k=add(t,-i);if(k<h.start)break;if(isDone(h,k)){seen=true;break}if(!isSched(h,k))continue;miss++}
    if(miss>=1&&seen)out.push({h,miss})});
  return out.slice(0,2).map(({h,miss})=>`<div class="c bn" role="group" aria-label="Welcome back: ${esc(h.name)}"><p><b>${miss===1?'Missing a day is normal.':'Welcome back!'}</b> ${miss===1?`You skipped ${esc(h.name)} last time it was planned.`:`It’s been ${miss} planned days since ${esc(h.name)}.`} Your earlier progress still counts. No catch-up needed.</p><div class="act" style="margin-top:0"><button class="sm" data-a="goto" data-id="${h.id}">Start again today</button><button class="sm" data-a="edit" data-id="${h.id}">${h.type==='count'?'Try a smaller target':'Adjust schedule'}</button><button class="sm" data-a="dismiss" data-id="${h.id}">Not now</button></div></div>`).join('')}
function banners(){
  let s='';
  if(saveFailed)s+=`<div class="c bn w" role="alert"><p><b>Changes couldn’t be saved.</b> ${syncMsg?esc(syncMsg)+' ':''}We’ll keep trying while this page is open. If it keeps happening, export a backup from Profile.</p></div>`;
  if(ui.localOffer)s+=`<div class="c bn" role="status"><p><b>Found habits from the earlier version.</b> They’re saved in this browser only. Add them to your account?</p><div class="act" style="margin-top:0"><button class="sm" data-a="local-import">Add them</button><button class="sm" data-a="local-skip">No thanks</button></div></div>`;
  if(loadMsg)s+=`<div class="c bn" role="status"><p>${esc(loadMsg)}</p><div class="act" style="margin-top:0"><button class="sm" data-a="dismiss-load">Got it</button></div></div>`;
  return s}
const STARTERS=[{name:'Drink water',icon:'water',type:'count',goal:8,unit:'glasses',increment:1},{name:'Read',icon:'book',type:'count',goal:20,unit:'pages',increment:1},{name:'Focus for 20 minutes',icon:'study',type:'duration',goal:20,unit:'min'},{name:'Wind down for bed',icon:'moon',type:'check'}];
function welcome(){
  return `<div class="c hero"><h2>Welcome. Let’s start small.</h2><p class="m" style="font-size:14px;line-height:1.5;margin:0 0 12px">Pick one or two habits you can actually do on a bad day. You can make them bigger later.</p><form data-f="name" class="row" style="max-width:360px;margin:0 auto"><label for="nm0" class="sr">Your name (optional)</label><input id="nm0" maxlength="30" placeholder="Your name (optional)" autocomplete="given-name"><button class="chip" style="flex:none">Save</button></form><div class="ex"><div class="lb" style="margin:0">Try one of these</div>${STARTERS.map((s,i)=>`<button data-a="starter" data-t="${i}">${esc(s.name)}<small>${s.type==='duration'?s.goal+' '+esc(s.unit)+' target':s.type==='count'?s.goal+' '+esc(s.unit)+' a day':'Simple check, every day'}</small></button>`).join('')}</div><div class="act" style="justify-content:center"><button class="sm" data-a="add">Create your own</button><button class="sm" data-a="demo">Explore with demo data</button></div><p class="m">Your habits are saved to your account, so they’re there on every device.</p></div>`}
function home(){
  const t=today(),k=ui.sel||t,hs=active();
  if(!S.habits.length)return `<h1 tabindex="-1">${greet()}</h1>${banners()}${connectCard()}<div style="height:16px"></div>${welcome()}`;
  const list=S.habits.filter(h=>visible(h,k)),dc=dayCount(k);
  const strk=hs.filter(h=>h.start<=t).map(h=>Object.assign({h},streakOf(h))).filter(s=>s.n>0).sort((a,b)=>b.n*(b.unit==='week'?7:1)-a.n*(a.unit==='week'?7:1))[0];
  const wk=rangeStats(weekKeys(t));
  const st=[['Today',dc.total?dc.done+' / '+dc.total:'—',dc.total?'habits done':'nothing planned'],['Current streak',strk?'<span class="fl">'+ic('flame')+'</span> '+strk.n+' '+strk.unit+(strk.n>1?'s':''):'—',strk?esc(strk.h.name):'Begins with a check-in'],['Active habits',hs.length,'paused ones are in Habits'],['This week',wk.pct==null?'—':wk.pct+'%',wk.sched?wk.done+' of '+wk.sched+' check-ins':'no data yet']].map(s=>`<div class="c"><div class="m">${s[0]}</div><div style="font-size:24px;font-weight:800">${s[1]}</div><div class="m">${s[2]}</div></div>`).join('');
  let days='';
  for(let i=13;i>=0;i--){const dk=add(t,-i);days+=`<button class="dy ${dk===k?'s':''}" data-a="selday" data-k="${dk}" aria-pressed="${dk===k}" aria-label="${fmt(dk,{weekday:'long',month:'long',day:'numeric'})}${dk===t?' (today)':''}">${fmt(dk,{weekday:'short'})}<b>${P(dk).getDate()}</b></button>`}
  return `<h1 tabindex="-1">${greet()}</h1><div class="m" style="font-size:14px;margin:4px 0 16px">Small steps count. A missed day doesn’t erase your progress.</div>${banners()}${recovery()}${hero(dc,k,t)}${experienceCard()}${connectCard()}<div class="g g4" style="margin-top:8px">${st}</div>${remCard(k,t)}<div class="row sp"><h2>${k===t?'Today’s habits':fmt(k,{weekday:'long',month:'short',day:'numeric'})}</h2><span class="m" aria-live="polite">${dc.done} of ${dc.total} done</span></div>${k!==t?`<div class="row sp c" style="margin-bottom:8px"><span class="m">Viewing historical progress. Daily records are read-only.</span><button class="sm" data-a="today">Back to today</button></div>`:''}<div class="days" id="ds" role="group" aria-label="Choose a day">${days}</div><div class="g hl" style="margin-top:12px">${list.length?list.map(h=>card(h,k)).join(''):'<div class="c">Nothing planned for this day. Rest is part of the plan.</div>'}</div>${hs.length===0?'<div class="c" style="margin-top:12px">All your habits are archived. Restore one in Habits, or add a new one.</div>':''}${k===t?'<button class="btn fab" data-a="add">+ Add habit</button>':''}`}
function connectCard(){
  return `<div class="c connect-card"><div class="ic">${ic('connect')}</div><div class="grow"><b>Connect Health Connect</b><div class="m">Import today’s steps from an Android device.</div></div><button class="sm connect-open" data-a="connect">${ic('connect')}Connect</button></div>`
}
function hero(dc,k,t){
  const p=dc.total?dc.done/dc.total:0,left=dc.total-dc.done;
  const msg=!dc.total?'Nothing planned. Rest is part of the plan.':p>=1?pick(DONE_MSGS,dc.done):dc.done===0?(k===t?'Ready when you are. One small step is enough.':'Nothing logged for this day yet.'):`Nice, ${dc.done} down. ${left} to go.`;
  return `<div class="hero2"><div class="ring" id="ring" data-p="${p}"><svg viewBox="0 0 84 84" aria-hidden="true"><circle class="tk" cx="42" cy="42" r="34"/><circle class="pg" cx="42" cy="42" r="34" style="stroke-dashoffset:${(213.63*(1-ui.ringPrev)).toFixed(2)}"/></svg><b aria-hidden="true">${dc.total?dc.done+'/'+dc.total:'–'}</b></div><div class="grow"><div class="m">${k===t?'Today':fmt(k,{weekday:'long'})}</div><div class="big">${msg}</div></div></div>`}
function experienceCard(){
  const x=S.xp||blank().xp,w=x.weekly||blank().xp.weekly;
  const pct=x.xp_to_next?Math.min(100,Math.round(x.xp_in_level/x.xp_to_next*100)):0;
  const weekPct=w.target?Math.min(100,Math.round(w.done/w.target*100)):0;
  const weeklyText=w.target
    ?`${w.done} of ${w.target} planned goals completed so far this week`
    :'No scheduled goals due yet this week.';
  const streakText=w.streak
    ?`${w.streak}-week perfect streak · next bonus +${w.next_bonus} XP`
    :`Perfect week bonus: +${w.next_bonus} XP`;
  return `<section class="xp-card" aria-label="Experience and level progress"><div class="xp-head"><div class="xp-level" aria-label="Level ${x.level}">LVL <b>${x.level}</b></div><div class="grow"><div class="xp-kicker">${esc(x.rank)} rank</div><div class="xp-total">${Number(x.total).toLocaleString()} XP</div><div class="m">${x.xp_in_level} / ${x.xp_to_next} XP to level ${x.level+1}</div></div><div class="xp-star" aria-hidden="true">XP</div></div><div class="xp-bar" role="progressbar" aria-label="Level progress" aria-valuemin="0" aria-valuemax="${x.xp_to_next}" aria-valuenow="${x.xp_in_level}"><i style="width:${pct}%"></i></div><div class="xp-week"><div class="row sp"><b>Weekly consistency</b><span class="xp-bonus">+${w.next_bonus} XP</span></div><div class="m">${esc(weeklyText)}</div>${w.target?`<div class="xp-bar slim" role="progressbar" aria-label="Weekly consistency progress" aria-valuemin="0" aria-valuemax="${w.target}" aria-valuenow="${w.done}"><i style="width:${weekPct}%"></i></div>`:''}<div class="m">${esc(streakText)} · complete all scheduled goals for the week</div></div></section>`}
const pick=(a,i)=>a[i%a.length];
function remCard(k,t){
  if(k!==t)return'';
  const hs=active().filter(h=>h.remind&&h.start<=t&&(h.freq==='weekly'||isSched(h,t))).sort((a,b)=>a.remind.localeCompare(b.remind));
  const off=!S.prefs.inapp&&!S.prefs.remind;
  if(!hs.length)return S.habits.some(h=>!h.archived)?`<div class="c" style="margin-top:8px"><div class="row sp"><span class="m" style="font-size:13px">${ic('bell')} Want a nudge? Tap <b>Remind me</b> on any habit.</span></div></div>`:'';
  const n=new Date(),now=n.getHours()*60+n.getMinutes();let nextDone=false;
  const rows=hs.map(h=>{const dn=isDone(h,t),up=mins(h.remind)>now;let pill=dn?'<span class="pill dn">Done</span>':up&&!nextDone?(nextDone=true,'<span class="pill nx">Up next</span>'):up?'<span class="pill">Later</span>':'<span class="pill">Time passed. Still time.</span>';
    return `<div class="rl"><span class="tm">${fmtTime(h.remind)}</span><span class="grow">${esc(h.name)}</span>${pill}</div>`}).join('');
  return `<div class="c" style="margin-top:8px"><div class="row sp"><b>${ic('bell')} Today’s reminders</b>${off?'<button class="sm" data-a="tab" data-t="profile">Turned off</button>':''}</div><div style="margin-top:6px">${rows}</div></div>`}
function greet(){const h=new Date().getHours();return`Good ${h<12?'morning':h<18?'afternoon':'evening'}${S.name?', '+esc(S.name):''}`}
function habitsView(){
  const f=ui.filter,t=today();
  const ok=h=>f==='Archived'?h.archived:!h.archived&&(f==='All'||(f==='To do today'&&visible(h,t)&&!isDone(h,t))||(f==='Done today'&&isDone(h,t)));
  const list=S.habits.filter(ok);
  const groups=[['Every day',h=>h.freq==='daily'],['Specific days',h=>h.freq==='days'],['Weekly goals',h=>h.freq==='weekly']];
  const item=h=>{
    if(h.archived)return `<div class="c"><div class="row"><div class="ic">${ic(h.icon)}</div><div class="grow"><b>${esc(h.name)}</b><div class="m">${schedLabel(h)} · history kept</div></div></div><div class="act"><button class="sm" data-a="unarch" data-id="${h.id}">${ic('undo')}Restore</button><button class="sm" data-a="del" data-id="${h.id}">${ic('trash')}Delete</button></div></div>`;
    if(h.start>t)return `<div class="c"><div class="row"><div class="ic">${ic(h.icon)}</div><div class="grow"><b>${esc(h.name)}</b><div class="m">Starts ${fmt(h.start,{month:'short',day:'numeric'})} · ${schedLabel(h)}</div></div><button class="sm" data-a="edit" data-id="${h.id}">${ic('edit')}Edit</button></div></div>`;
    return card(h,t)};
  let body='';
  if(f==='Archived')body=list.length?`<div class="g hl" style="margin-top:12px">${list.map(item).join('')}</div>`:'<div class="c" style="margin-top:12px">No archived habits. Archiving pauses a habit and keeps its history.</div>';
  else groups.forEach(([n,fn])=>{const l=list.filter(fn);if(l.length)body+=`<h2>${n}</h2><div class="g hl">${l.map(item).join('')}</div>`});
  if(!body)body=S.habits.length?'<div class="c" style="margin-top:12px">Nothing here right now.</div>':welcome();
  const sub=f==='All'||f==='Archived'?'':'';
  return `<h1 tabindex="-1">My habits</h1><div class="m" style="margin-top:4px">Tap a habit’s Edit button to change its goal, schedule, or archive it.</div><div class="days" role="group" aria-label="Filter habits" style="margin:16px 0 0">${['All','To do today','Done today','Archived'].map(c=>`<button class="chip ${c===f?'s':''}" data-a="filter" data-t="${c}" aria-pressed="${c===f}">${c}${c==='Archived'&&S.habits.some(h=>h.archived)?' ('+S.habits.filter(h=>h.archived).length+')':''}</button>`).join('')}</div>${sub}${body}<button class="btn fab" data-a="add">+ Add habit</button>`}
function calendar(){
  const t=today();if(!ui.month){const d=P(t);ui.month={y:d.getFullYear(),m:d.getMonth()}}
  const{y,m}=ui.month,first=(new Date(y,m,1).getDay()+(S.prefs.week==='sun'?0:6))%7,dim=new Date(y,m+1,0).getDate();
  const heads=(S.prefs.week==='sun'?['S','M','T','W','T','F','S']:['M','T','W','T','F','S','S']).map(x=>`<div class="m" aria-hidden="true">${x}</div>`).join('');
  let c=heads+'<div></div>'.repeat(first);
  for(let d=1;d<=dim;d++){
    const k=KD(new Date(y,m,d)),lab=fmt(k,{weekday:'long',month:'long',day:'numeric'});
    if(k>t){c+=`<button class="cd f" data-a="openday" data-k="${k}" aria-label="${lab}, future date, read-only">${d}</button>`;continue}
    const dc=dayCount(k),p=dc.total?dc.done/dc.total:0,lv=!dc.total||dc.done===0?'':p>=1?'l4':p>=.5?'l2':'l1';
    c+=`<button class="cd ${lv} ${k===t?'t':''}" data-a="openday" data-k="${k}" aria-label="${lab}${k===t?' (today)':''}: ${dc.total?dc.done+' of '+dc.total+' habits done':'nothing planned'}">${d}</button>`}
  return `<div class="row sp"><h1 tabindex="-1">${new Date(y,m,1).toLocaleDateString('en',{month:'long',year:'numeric'})}</h1><div class="row"><button class="chip" data-a="mprev" aria-label="Previous month">‹</button><button class="chip" data-a="mnext" aria-label="Next month">›</button></div></div><p class="m">Tap a day to view its check-ins. Only today’s records can be changed; future days are unavailable.</p><div class="cal">${c}</div><div class="lg m"><span><i></i>None done</span><span><i style="background:color-mix(in srgb,var(--ac) 25%,var(--card))"></i>Some</span><span><i style="background:color-mix(in srgb,var(--ac) 50%,var(--card))"></i>Half or more</span><span><i style="background:var(--ac)"></i>All done</span></div><div style="margin-top:12px"><button class="chip" data-a="thismonth">Today</button></div>`}
function dayHTML(k){
  const dc=dayCount(k),list=S.habits.filter(h=>visible(h,k));
  return `<h1 id="sht" tabindex="-1" data-first>${fmt(k,{weekday:'long',month:'short',day:'numeric'})}</h1><div class="m" style="margin:4px 0 12px">${dc.done} of ${dc.total} done${k===today()?'':' · Read-only history'}</div><div class="g">${list.length?list.map(h=>card(h,k,'day')).join(''):'<div class="c">Nothing was planned for this day.</div>'}</div><button class="btn sec" style="margin-top:12px" data-a="close">Close</button>`}
function insights(){
  const t=today(),hs=active();
  if(!hs.length)return `<h1 tabindex="-1">Insights</h1><div class="c" style="margin-top:16px">Insights appear once you’ve added a habit and logged a few days.</div>`;
  const cur=wsOff(t),wkKeys=weekKeys(t),r7=rangeStats([...Array(7)].map((_,i)=>add(t,-i)));
  const cmp=(()=>{const n=cur+1,a=rangeStats(wkKeys.slice(0,n)),b=rangeStats(weekKeys(add(t,-7)).slice(0,n));return a.sched>=5&&b.sched>=5?(a.pct>=b.pct?`You’re ${a.pct-b.pct} points ${a.pct===b.pct?'level with':'above'} the same point last week.`:`You’re ${b.pct-a.pct} points below the same point last week. That’s fine. Pick one habit to protect today.`):''})();
  const streaks=hs.map(h=>Object.assign({h},streakOf(h),{b:bestOf(h)})).filter(s=>s.h.start<=t);
  let topS=streaks.slice().sort((a,b)=>b.n*(b.unit==='week'?7:1)-a.n*(a.unit==='week'?7:1))[0];
  if(topS&&topS.n===0)topS=null;
  const topB=streaks.slice().sort((a,b)=>b.b.n*(b.b.unit==='week'?7:1)-a.b.n*(a.b.unit==='week'?7:1))[0];
  const bars=wkKeys.map(k=>{const dc=k>t?null:dayCount(k);const p=dc&&dc.total?Math.round(dc.done/dc.total*100):null;return{k,dc,p}});
  const bar=bars.map(b=>`<div><span class="m">${b.p!==null?b.dc.done+'/'+b.dc.total:''}</span><i style="height:${b.p!==null?Math.max(b.p,4):4}px;${b.p===null?'background:var(--tr)':''}"></i></div>`).join('');
  const lab=bars.map(b=>`<div class="m" style="flex:1;text-align:center">${fmt(b.k,{weekday:'short'})}</div>`).join('');
  const sum=bars.map(b=>fmt(b.k,{weekday:'long'})+': '+(b.p!==null?b.dc.done+' of '+b.dc.total+' done':b.k>t?'upcoming':'nothing planned')).join('. ');
  const rs=hs.map(h=>Object.assign({h},rate(h,30))).filter(x=>x.pct!==null).sort((a,b)=>b.pct-a.pct);
  const pr=x=>`<div class="c"><div class="row sp"><b>${esc(x.h.name)}</b><span class="m">${x.pct}%</span></div><div class="m">${x.done} of ${x.sched} ${x.h.freq==='weekly'?'expected check-ins':'planned days'}</div><div class="bar" aria-hidden="true"><i style="width:${x.pct}%"></i></div></div>`;
  const best=rs.slice(0,2),needs=rs.length>2?rs.slice(-2).reverse().filter(x=>x.pct<80):[];
  const needsHTML=needs.map(x=>pr(x)+`<div class="act" style="margin:0 0 4px"><button class="sm" data-a="edit" data-id="${x.h.id}">${x.h.type==='count'?'Try a smaller target':'Adjust schedule'}</button></div>`).join('');
  /* weekday pattern */
  const by=[...Array(7)].map(()=>({d:0,s:0}));let tot=0,totDone=0;
  for(let i=0;i<84;i++){const k=add(t,-i);hs.forEach(h=>{if(h.freq==='weekly'||k<h.start)return;const d=isDone(h,k);if(isSched(h,k)||d){if(d||k!==t){by[dow(k)].s++;tot++;if(d){by[dow(k)].d++;totDone++}}}})}
  const ok=by.map((x,i)=>({i,p:Math.round(x.d/x.s*100),s:x.s})).filter(x=>x.s>=3);
  let pat='Patterns show up after about three weeks of check-ins. Keep going.';
  if(tot>=21&&totDone>=10&&ok.length>=4){const hi=ok.slice().sort((a,b)=>b.p-a.p)[0],lo=ok.slice().sort((a,b)=>a.p-b.p)[0];
    pat=hi.p-lo.p>=20?`You complete more on ${DL[hi.i]} (${hi.p}%) than on ${DL[lo.i]} (${lo.p}%), based on the last 12 weeks. Consider a lighter plan for ${DL[lo.i]}.`:'No clear day-of-week pattern in the last 12 weeks.'}
  const notes=[];S.habits.forEach(h=>{const L=S.logs[h.id]||{};Object.keys(L).forEach(k=>{if(L[k].note)notes.push({k,h,n:L[k].note})})});
  notes.sort((a,b)=>b.k.localeCompare(a.k));
  return `<h1 tabindex="-1">Insights</h1><div class="g g2" style="margin-top:16px"><div class="c" style="text-align:center"><div class="m">Last 7 days</div><div style="font-size:44px;font-weight:800;color:var(--ac)">${r7.pct==null||r7.sched<3?'—':r7.pct+'%'}</div><div class="m">${r7.sched>=3?r7.done+' of '+r7.sched+' planned check-ins':'Not enough data yet'}</div></div><div class="c"><div class="m">Streaks</div><div style="font-size:20px;font-weight:800;margin-top:6px">${topS?topS.n+' '+topS.unit+(topS.n>1?'s':'')+' now':'None yet'}</div><div class="m">${topS?esc(topS.h.name)+'. ':''}${topB&&topB.b.n?'Longest: '+topB.b.n+' '+topB.b.unit+(topB.b.n>1?'s':'')+' ('+esc(topB.h.name)+')':''}</div></div></div>${cmp?`<div class="c" style="margin-top:8px">${cmp}</div>`:''}
<h2>This week</h2><div class="c"><div class="mom" role="img" aria-label="${esc(sum)}">${bar}</div><div class="row" style="gap:10px;margin-top:6px" aria-hidden="true">${lab}</div></div>
<h2>Habit performance (30 days)</h2>${rs.length?`<div class="g hl"><div class="g"><div class="m">Going well</div>${best.map(pr).join('')}</div>${needsHTML?`<div class="g"><div class="m">Could use a smaller step</div>${needsHTML}</div>`:''}</div>`:'<div class="c">Needs at least 3 planned days per habit before rates mean anything.</div>'}
<h2>Pattern</h2><div class="c">${pat}</div>
${notes.length?`<h2>Your notes</h2><div class="g">${notes.slice(0,5).map(n=>`<div class="c"><div class="m">${fmt(n.k,{month:'short',day:'numeric'})} · ${esc(n.h.name)}</div><div>${esc(n.n)}</div></div>`).join('')}</div>`:''}
<details><summary>How these numbers are calculated</summary><p><b>Completion rate</b> = completed ÷ planned check-ins. Today only counts once you’ve completed it, so an unfinished day never lowers your rate. <b>Streaks</b> count consecutive planned days you completed; days off your schedule are skipped, not broken, and today doesn’t break a streak until it’s over. <b>Weekly goals</b> count weeks in which you met your target, and their rate is prorated (target × days ÷ 7). <b>Archived habits</b> are left out. Percentages are hidden until there are at least 3 planned days.</p></details>`}
function profile(){
  const tot=S.habits.reduce((a,h)=>a+Object.keys(S.logs[h.id]||{}).filter(k=>isDone(h,k)).length,0);
  const best=Math.max(0,...active().map(h=>{const b=bestOf(h);return b.unit==='day'?b.n:0}));
  const sup='Notification' in window,perm=sup?Notification.permission:'unsupported';
  const rem=sup?(perm==='denied'?'Browser notifications are blocked. In-app reminders still play a sound while this page is open.':'In-app reminders play a sound while this page is open. Tap once after opening the app to enable sound.'):'Browser notifications are unavailable; in-app reminders still play a sound while this page is open.';
  return `<div class="row"><div class="ic" style="width:64px;height:64px;border-radius:50%;background:var(--ink);color:var(--bg);font-size:24px;font-weight:800" aria-hidden="true">${esc((S.name||'You').charAt(0).toUpperCase())}</div><div><h1 tabindex="-1">${S.name?esc(S.name):'Profile'}</h1><div class="m">Tracking ${active().length} active habit${active().length===1?'':'s'}</div></div></div><div class="g g4" style="margin-top:16px">${[['Habits',S.habits.length],['Check-ins done',tot],['Longest daily streak',best+' d'],['Today',(()=>{const d=dayCount(today());return d.total?d.done+'/'+d.total:'—'})()]].map(s=>`<div class="c"><div class="m">${s[0]}</div><b style="font-size:20px">${s[1]}</b></div>`).join('')}</div>
<h2>Game progress</h2>${experienceCard()}<div class="c xp-rules"><b>How XP works</b><p>Earn 10 XP the first time you meet a habit’s daily goal. Partial progress doesn’t earn points. Complete every scheduled goal in a full week for a +25 XP bonus; consecutive perfect weeks add another +10 each, up to +50 extra. Weekly goals count when their weekly target is met. Existing completed history counts toward your score, and XP stays on your account even if you later undo progress or reset your habits.</p></div>
<h2>Settings</h2><div class="c"><label for="nm" style="margin-top:0">Display name</label><input id="nm" maxlength="30" value="${esc(S.name)}" placeholder="Optional" autocomplete="given-name"><label for="th">Theme</label><select id="th">${[['auto','System'],['light','Light'],['dark','Dark']].map(o=>`<option value="${o[0]}"${S.prefs.theme===o[0]?' selected':''}>${o[1]}</option>`).join('')}</select><label for="ws">Week starts on</label><select id="ws"><option value="mon"${S.prefs.week==='mon'?' selected':''}>Monday</option><option value="sun"${S.prefs.week==='sun'?' selected':''}>Sunday</option></select></div>
<h2>Reminders</h2><div class="c"><p class="m" style="margin:0 0 8px;font-size:13px;line-height:1.5">Set a time on any habit with its <b>Remind me</b> button. A repeating sound and reminder card stay active until you dismiss or snooze them. Browser notifications also alert you when a duration timer reaches its goal. Reminders only fire while this page is open. Tap once after opening the app to enable sound; they can’t wake a closed app or a locked phone.</p>
<div class="row sp" style="padding:8px 0"><span id="r2"><b>Browser notifications</b><div class="m" id="rd">${rem}</div></span><button class="tg" role="switch" aria-checked="${S.prefs.remind}" aria-labelledby="r2" aria-describedby="rd" data-a="remind"${sup?'':' disabled'}></button></div>
<button class="chip" style="margin-top:8px" data-a="test-rem">Send a test reminder</button></div>
<h2>Account</h2><div class="c"><div class="row sp"><span><b>${esc(ui.user||'')}</b><div class="m">Signed in</div></span><button class="chip" data-a="logout">Sign out</button></div></div>
<h2>Your data</h2><div class="c"><p style="margin:0 0 12px;line-height:1.5">Your habits are saved to your account on the server and sync across your devices. Export a backup now and then if you like.</p><div class="g g2"><button class="chip" data-a="export">Export data</button><button class="chip" data-a="import">Import data</button></div><div class="g g2" style="margin-top:8px">${S.habits.some(h=>h.demo)?'<button class="chip" data-a="clear-demo">Remove demo data</button>':''}<button class="chip" data-a="reset">Reset everything</button></div></div>`}
const VIEWS={home,habits:habitsView,calendar,insights,profile};
const TABS=[['home','Home','home'],['habits','Habits','list'],['calendar','Calendar','cal'],['insights','Insights','chart'],['profile','Profile','user']];
function render(){
  const act=document.activeElement,inMain=$('v').contains(act)||$('nav').contains(act),key=inMain?keyOf(act):null;
  const old=$('ds'),sl=old?old.scrollLeft:null;
  const ready=ui.boot==='ready';$('app').classList.toggle('noauth',!ready);
  $('v').innerHTML=ready?VIEWS[ui.tab]():BOOT[ui.boot]();
  $('nav').innerHTML=!ready?'':TABS.map(t=>`<button class="${ui.tab===t[0]?'s':''}${ui.anim&&ui.tab===t[0]?' jump':''}" ${ui.tab===t[0]?'aria-current="page"':''} data-a="tab" data-t="${t[0]}">${ic(t[2])}${t[1]}</button>`).join('');
  const ds=$('ds');if(ds)ds.scrollLeft=sl!==null?sl:ds.scrollWidth;
  const mv=$('v');mv.classList.remove('anim');
  if(ui.anim&&!calm()){mv.querySelectorAll('.c,.dy,.cd,.hero2').forEach((e,i)=>e.style.setProperty('--i',Math.min(i,14)));mv.classList.add('anim')}
  ui.anim=false;animateBars();updateTimerClocks();
  try{coachSync()}catch(e){}
  if(key){const el=$('app').querySelector(selOf(key));if(el)el.focus({preventScroll:true})}}
function animateBars(){
  const els=document.querySelectorAll('.bar i[data-bk]');
  if(els.length)void document.body.offsetWidth;
  els.forEach(i=>{const w=Number(i.dataset.w)||0;i.style.width=w+'%';ui.bars[i.dataset.bk]=w});
  const r=$('ring');
  if(r){const p=Number(r.dataset.p)||0,pg=r.querySelector('.pg');void r.offsetWidth;pg.style.strokeDashoffset=(213.63*(1-p)).toFixed(2);ui.ringPrev=p}}
function burst(el,n){
  if(!el||calm())return;const cols=['#1F6F4E','#4FB88A','#F5B83D','#E86A5C','#5B8DEF','#B57BEE'];
  for(let i=0;i<n;i++){const s=document.createElement('span');s.className='cf';s.setAttribute('aria-hidden','true');
    const a=Math.random()*Math.PI*2,d=34+Math.random()*(n>14?60:34);
    s.style.setProperty('--dx',Math.cos(a)*d+'px');s.style.setProperty('--dy',Math.sin(a)*d+'px');s.style.setProperty('--r',(Math.random()*540-270)+'deg');s.style.setProperty('--c',cols[i%cols.length]);
    el.appendChild(s);setTimeout(()=>s.remove(),1000)}}
function celebrate(id,k,wasAll){
  try{coachReact(id,k,wasAll)}catch(e){}
  const b=document.querySelector(`[data-a="tg"][data-id="${CSS.escape(id)}"][data-k="${k}"]`);
  if(b&&!calm()){b.classList.add('pop');burst(b,12)}
  if(k===today()){const dc=dayCount(k);
    if(dc.total&&dc.done===dc.total&&!wasAll){const r=$('ring');if(r)burst(r,28);toast(pick(DONE_MSGS,Math.floor(Math.random()*3)))}}}
const allDone=()=>{const d=dayCount(today());return d.total>0&&d.done===d.total};
function theme(){const r=document.documentElement;if(S.prefs.theme==='auto')r.removeAttribute('data-theme');else r.dataset.theme=S.prefs.theme}

/* ---------- habit form ---------- */
function formHTML(h,pre){
  const e=!!h,v=h||pre||{},type=v.type||'check',freq=v.freq||'daily',days=v.days||[0,1,2,3,4];
  return `<h1 id="sht" tabindex="-1">${e?'Edit habit':'New habit'}</h1><form data-f="habit" data-id="${e?h.id:''}" novalidate>
<label for="fn">Habit name</label><input id="fn" name="name" maxlength="40" value="${esc(v.name||'')}" placeholder="e.g. Read 20 minutes" data-first autocomplete="off">
<fieldset><legend>Icon</legend><div class="pick">${PICK.map(i=>`<label><input type="radio" name="icon" value="${i}" class="sr"${(v.icon||'water')===i?' checked':''}><span class="ic"><span class="sr">${i}</span>${ic(i)}</span></label>`).join('')}</div></fieldset>
<fieldset><legend>How do you track it?</legend><label class="opt"><input type="radio" name="type" value="check"${type==='check'?' checked':''}${e?' disabled':''}><span>Simple check<small>Done or not done</small></span></label><label class="opt"><input type="radio" name="type" value="count"${type==='count'?' checked':''}${e?' disabled':''}><span>Count toward a goal<small>Track quantities, such as glasses or pages</small></span></label><label class="opt"><input type="radio" name="type" value="duration"${type==='duration'?' checked':''}${e?' disabled':''}><span>Track time<small>Use a persistent stopwatch for focus sessions</small></span></label>${e?'<div class="m">Tracking type can’t change after creation, so past records stay accurate.</div>':''}</fieldset>
<div class="g g2" id="gf"${type==='count'||type==='duration'?'':' hidden'}><div><label for="fg">Daily goal</label><input id="fg" name="goal" type="number" inputmode="numeric" min="${type==='duration'?'1':'1'}" step="1" value="${v.goal&&type!=='check'?v.goal:''}" placeholder="${type==='duration'?'20':'8'}"></div><div><label for="fu">Unit</label><input id="fu" name="unit" maxlength="20" value="${esc(v.unit||'')}" placeholder="${type==='duration'?'min':'glasses, steps, pages'}"></div></div>
<div id="incf"${type==='count'?'':' hidden'}><label for="fi">Increment amount</label><input id="fi" name="increment" type="number" inputmode="numeric" min="1" max="100000" step="1" value="${type==='count'?v.increment||1:1}"></div>
${e&&(type==='count'||type==='duration')?'<div class="m">Goal changes apply from today. Past days keep the goal they had.</div>':''}
<label for="ff">Schedule</label><select id="ff" name="freq"><option value="daily"${freq==='daily'?' selected':''}>Every day</option><option value="days"${freq==='days'?' selected':''}>Selected days</option><option value="weekly"${freq==='weekly'?' selected':''}>Weekly goal (any days)</option></select>
<fieldset id="df"${freq==='days'?'':' hidden'}><legend>Which days?</legend><div class="pick">${DN.map((d,i)=>`<label><input type="checkbox" name="day" value="${i}" class="sr"${days.includes(i)?' checked':''}><span class="wdl">${d}</span></label>`).join('')}</div></fieldset>
<div id="wf"${freq==='weekly'?'':' hidden'}><label for="fw">Times per week</label><input id="fw" name="wk" type="number" min="1" max="7" step="1" value="${v.wk||3}"></div>
<div class="g g2"><div><label for="fr">Reminder time (optional)</label><input id="fr" name="remind" type="time" value="${esc(v.remind||'')}"></div><div><label for="fs">Start date</label><input id="fs" name="start" type="date" value="${esc(v.start||today())}"></div></div>
<div class="m" style="margin-top:6px">Reminders pop up only while this page is open in a browser tab. Manage them in Profile.</div>
<div class="er" id="er" role="alert"></div>
<div class="g" style="margin-top:12px"><button class="btn">${e?'Save changes':'Create habit'}</button><button type="button" class="btn sec" data-a="close">Cancel</button>${e?`<div class="g g2"><button type="button" class="btn sec" data-a="${h.archived?'unarch':'arch'}" data-id="${h.id}">${h.archived?'Restore':'Archive'}</button><button type="button" class="btn sec" data-a="del" data-id="${h.id}">Delete…</button></div>`:''}</div></form>`}
function syncForm(f){
  const t=(f.querySelector('[name=type]:checked')||{}).value,q=f.querySelector('[name=freq]').value;
  f.querySelector('#gf').hidden=t!=='count'&&t!=='duration';
  f.querySelector('#incf').hidden=t!=='count';
  f.querySelector('#df').hidden=q!=='days';f.querySelector('#wf').hidden=q!=='weekly';
  const goal=f.querySelector('#fg');goal.min='1';goal.placeholder=t==='duration'?'20':'8';
  f.querySelector('label[for=fg]').textContent=t==='duration'?'Daily time target (minutes)':'Daily goal';
  f.querySelector('#fu').placeholder=t==='duration'?'min':'glasses, steps, pages'}
function saveHabit(form){
  const fd=new FormData(form),id=form.dataset.id,ex=id?S.habits.find(x=>x.id===id):null;
  const err=(m,s)=>{$('er').textContent=m;const el=form.querySelector(s);if(el)el.focus()};
  const name=String(fd.get('name')||'').trim();if(!name)return err('Give your habit a name.','[name=name]');
  const type=ex?ex.type:(['count','duration'].includes(fd.get('type'))?fd.get('type'):'check');
  let goal=1,unit='',increment=1;
  if(type==='count'||type==='duration'){
    goal=Number(fd.get('goal'));
    if(!Number.isInteger(goal)||goal<1||goal>100000)return err('Enter a whole-number daily target from 1 to 100,000.','[name=goal]');
    unit=String(fd.get('unit')||'').trim().slice(0,20);
    if(type==='duration')unit=unit||'min';
    if(type==='count'){
      increment=Number(fd.get('increment'));
      if(!Number.isInteger(increment)||increment<1||increment>100000)return err('Enter an increment from 1 to 100,000.','[name=increment]')
    }}
  const freq=['daily','days','weekly'].includes(fd.get('freq'))?fd.get('freq'):'daily';
  const days=fd.getAll('day').map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=6).sort();
  if(freq==='days'&&!days.length)return err('Pick at least one day.','[name=day]');
  const wk=Number(fd.get('wk'));if(freq==='weekly'&&!(Number.isInteger(wk)&&wk>=1&&wk<=7))return err('Choose 1 to 7 times per week.','[name=wk]');
  const remind=String(fd.get('remind')||'');if(remind&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(remind))return err('Enter a valid reminder time.','[name=remind]');
  const start=String(fd.get('start')||'');if(!validDate(start)||start>add(today(),365))return err('Pick a valid start date within the next year.','[name=start]');
  const icon=IC[fd.get('icon')]?fd.get('icon'):'bolt';
  if(ex){
    if((type==='count'||type==='duration')&&goal!==ex.goal){ex.goal=goal;const e=(S.logs[ex.id]||{})[today()];if(e)e.g=goal}
    Object.assign(ex,{name,icon,unit,increment,freq,days:days.length?days:ex.days,wk:freq==='weekly'?wk:ex.wk,remind,start});
    save();closeSheet();toast('Saved '+name)}
  else{
    const h={id:newId(),name,icon,type,goal,unit,increment,freq,days:days.length?days:[0,1,2,3,4,5,6],wk:freq==='weekly'?wk:3,remind,start,archived:false,demo:false};
    S.habits.push(h);S.logs[h.id]={};save();closeSheet();toast('Created '+name)}}
function openAdd(pre){openSheet(formHTML(null,pre),{type:'form'})}

/* ---------- demo / io ---------- */
function loadDemo(){
  const t=today(),start=add(t,-27);
  [['Drink water','water','count',8,'glasses','daily',.8],['Read','book','count',30,'min','daily',.65],['Exercise','bolt','check',1,'','weekly',0],['Meditate','mind','count',10,'min','days',.6]].forEach((s,i)=>{
  const h={id:newId()+i,name:s[0],icon:s[1],type:s[2],goal:s[3],unit:s[4],increment:s[2]==='count'?(s[3]>=100?10:s[3]>=20?5:1):1,freq:s[5],days:s[5]==='days'?[0,1,2,3,4]:[0,1,2,3,4,5,6],wk:3,remind:'',start,archived:false,demo:true},L={};
    for(let n=0;n<27;n++){const k=add(start,n);
      const hit=s[5]==='weekly'?[1,3,5].includes(dow(k))&&(n*7+i)%5!==0:((n*7+i*13)%10)/10<s[6];
      if(hit&&(s[5]!=='days'||dow(k)<5)){L[k]={v:h.goal,g:h.goal};if(h.type==='count'&&(n+i)%4===0)L[k].v=h.goal}}
    S.habits.push(h);S.logs[h.id]=L});
  save();render();toast('Demo data added. You can remove it from Profile.')}
function doExport(){
  try{const b=new Blob([JSON.stringify({app:'habit-tracker',version:2,exportedAt:new Date().toISOString(),data:{name:S.name,prefs:S.prefs,habits:S.habits,logs:S.logs}},null,2)],{type:'application/json'});
    const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='habit-tracker-'+today()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);toast('Backup downloaded')}
  catch(e){toast('Export failed in this browser.')}}
function preservesNonTodayLogs(current,incoming){
  const records=state=>{
    const result={};
    Object.keys(state.logs||{}).forEach(id=>Object.keys(state.logs[id]||{}).forEach(day=>{
      if(day!==today())result[id+'|'+day]=JSON.stringify(state.logs[id][day])
    }));
    return Object.keys(result).sort().map(key=>[key,result[key]])
  };
  return JSON.stringify(records(current))===JSON.stringify(records(incoming))
}
function importFile(f){
  if(!f)return;
  if(f.size>5e6)return toast('That file is too large to be a backup.');
  const r=new FileReader();
  r.onload=()=>{let n;try{n=normalize(JSON.parse(String(r.result)))}catch(e){return toast('That file isn’t a valid Habit Tracker backup.')}
    if(!preservesNonTodayLogs(S,n))return toast('This backup would change or remove records outside today. Those records are read-only.');
    const cnt=Object.keys(n.logs).reduce((a,k)=>a+Object.keys(n.logs[k]).length,0);
    confirmSheet({title:'Replace your data?',body:`This backup has <b>${n.habits.length} habit${n.habits.length===1?'':'s'}</b> and <b>${cnt} day record${cnt===1?'':'s'}</b>. Importing <b>replaces everything</b> currently in this browser. Lifetime XP stays on your account.`,ok:'Replace with backup',danger:true,action:()=>{n.prefs.remind=false;n.xp=S.xp;S=n;save();theme();closeSheet();toast('Backup imported')}})};
  r.onerror=()=>toast('Couldn’t read that file.');
  r.readAsText(f)}
async function setRemind(){
  if(S.prefs.remind){S.prefs.remind=false;save();render();return}
  if(!('Notification' in window))return toast('This browser doesn’t support notifications.');
  let p=Notification.permission;
  if(p==='default'){try{p=await Notification.requestPermission()}catch(e){p='denied'}}
  if(p!=='granted'){S.prefs.remind=false;toast('Notifications are blocked. Allow them in your browser settings.')}
  else{S.prefs.remind=true;toast('Reminders on while this page is open')}
  save();render()}
/* ---- reminders: fire only while this page is open ---- */
let audio=null;
const ringing=new Map();
let soundWarningShown=false;
async function primeAudio(){
  const C=window.AudioContext||window.webkitAudioContext;
  if(!C)return false;
  try{
    audio=audio||new C();
    if(audio.state!=='running')await audio.resume();
    return audio.state==='running'
  }catch(e){console.error('Could not enable reminder sounds.',e);return false}
}
async function chime(id){
  if(!await primeAudio()){
    if(!soundWarningShown){toast('Could not play the reminder sound. Tap the page once and check your device volume.');soundWarningShown=true}
    return
  }
  soundWarningShown=false;
  if(!ringing.has(id))return;
  try{
    [660,880].forEach((f,i)=>{
      const t0=audio.currentTime+i*.2,o=audio.createOscillator(),g=audio.createGain();
      o.type='sine';o.frequency.value=f;o.connect(g);g.connect(audio.destination);
      g.gain.setValueAtTime(.0001,t0);g.gain.exponentialRampToValueAtTime(.3,t0+.03);
      g.gain.exponentialRampToValueAtTime(.0001,t0+.42);
      o.start(t0);o.stop(t0+.45)
    })
  }catch(e){console.error('Could not play the reminder chime.',e);toast('Could not play the reminder sound. Check your device volume and browser settings.')}
}
function startRinging(id){
  stopRinging(id);
  const timer=setInterval(()=>chime(id),1600);
  ringing.set(id,timer);
  chime(id)
}
function stopRinging(id){
  const timer=ringing.get(id);
  if(timer!==undefined){clearInterval(timer);ringing.delete(id)}
}
function fireReminder(h){
  ui.alerts=ui.alerts.filter(a=>a.id!==h.id);ui.alerts.push({id:h.id,name:h.name,type:h.type,fresh:true});renderAlerts();
  if(S.prefs.remind&&'Notification' in window&&Notification.permission==='granted'){try{new Notification(h.name,{body:'Time for a small step. A smaller version still counts.'})}catch(e){}}
  startRinging(h.id)}
function renderAlerts(){
  $('rem').innerHTML=ui.alerts.map(a=>`<div class="al${a.fresh?' fresh':''}" role="alert"><div class="row"><div class="ic bell">${ic('bell')}</div><div class="grow"><b>Time for ${esc(a.name)}</b><div class="m">A small step counts. A smaller version still counts.</div></div></div><div class="act">${a.id==='test'?'':a.type==='check'?`<button class="sm" data-a="al-done" data-id="${esc(a.id)}">${ic('ck')}Mark done</button>`:`<button class="sm" data-a="al-open" data-id="${esc(a.id)}">Log it</button>`}<button class="sm" data-a="al-snooze" data-id="${esc(a.id)}">Snooze 10 min</button><button class="sm" data-a="al-x" data-id="${esc(a.id)}">Dismiss</button></div></div>`).join('');
  ui.alerts.forEach(a=>a.fresh=false)}
function dropAlert(id){stopRinging(id);ui.alerts=ui.alerts.filter(a=>a.id!==id);renderAlerts()}
function tick(){
  const n=new Date(),now=n.getHours()*60+n.getMinutes(),t=today(),ts=n.getTime();
  active().forEach(h=>{
    if(!h.remind||isDone(h,t)||!due(h,t))return;
    const sn=snooze[h.id];let key=null;
    if(sn){if(ts>=sn&&ts-sn<10*60000)key=h.id+t+'s'+sn}
    else{const d=now-mins(h.remind);if(d>=0&&d<=5)key=h.id+t}
    if(key&&!notified.has(key)){notified.add(key);if(sn)delete snooze[h.id];fireReminder(h)}})}
setInterval(tick,15000);
setInterval(async()=>{
  if(ui.boot!=='ready')return;
  try{
    const me=await Api.me(),changed=acceptServerToday(me.today);
    if(changed){render();await Sync.pull()}
  }catch(e){console.error('Could not refresh the server date.',e)}
},60000);

const timerBusy=new Set();
const timerCompletionNotified=new Set();
const timerExperienceRequests=new Set();
function refreshTimerExperience(h,k){
  const key=h.id+'|'+k;
  if(timerExperienceRequests.has(key))return;
  timerExperienceRequests.add(key);
  Api.experience().then(result=>{
    const previousLevel=S.xp.level;
    S.xp=result.xp;
    if(ui.boot==='ready')render();
    if(result.xp_gained>0)toast(result.xp.level>previousLevel
      ?'Level up! Level '+result.xp.level+' · +'+result.xp_gained+' XP'
      :'+'+result.xp_gained+' XP earned');
  }).catch(e=>{
    console.error('Could not refresh timer experience points.',e);
    toast('Could not update XP right now. It will retry shortly.');
    setTimeout(()=>{
      if((getLog(h,k)||{}).timer_started_at){
        timerExperienceRequests.delete(key);
        refreshTimerExperience(h,k)
      }
    },10000)
  })
}
function notifyTimerComplete(h,target){
  if(!S.prefs.remind||!('Notification' in window)||Notification.permission!=='granted')return;
  try{
    new Notification('Timer complete: '+h.name,{body:'Your '+fmtDuration(target)+' timer goal has been reached.'})
  }catch(e){console.error('Could not show the timer completion notification.',e)}
}
function updateTimerClocks(){
  let reached=null;
  document.querySelectorAll('[data-timer-elapsed]').forEach(node=>{
    const [id,k]=node.dataset.timerElapsed.split('|'),h=S.habits.find(x=>x.id===id);
    if(!h)return;
    const seconds=trackedSeconds(h,k),target=goalFor(h,k)*60,pct=Math.min(100,Math.round(seconds/target*100));
    node.textContent=fmtDuration(seconds);
    const remaining=document.querySelector(`[data-timer-remaining="${CSS.escape(id+'|'+k)}"]`);
    if(remaining)remaining.textContent=`${fmtDuration(Math.max(0,target-seconds))} ${seconds>=target?'completed':'remaining'} · ${(getLog(h,k)?.timer_sessions||[]).length} session${(getLog(h,k)?.timer_sessions||[]).length===1?'':'s'} on ${k===today()?'today':fmt(k,{month:'short',day:'numeric'})}`;
    const bar=document.querySelector(`[data-timer-bar="${CSS.escape(id+'|'+k)}"]`);
    if(bar){bar.style.width=pct+'%';bar.parentElement.setAttribute('aria-valuenow',String(pct));bar.parentElement.setAttribute('aria-valuetext',`${h.name}: ${fmtDuration(seconds)} of ${fmtDuration(target)} tracked`)}
    const completionKey=id+'|'+k;
    if((getLog(h,k)||{}).timer_started_at&&seconds>=target){
      refreshTimerExperience(h,k);
      if(!timerCompletionNotified.has(completionKey)){
        timerCompletionNotified.add(completionKey);reached=h;notifyTimerComplete(h,target)
      }
    }
  });
  if(reached&&ui.boot==='ready'){render();toast('Goal reached: '+reached.name)}
}
setInterval(updateTimerClocks,1000);
async function persistTimerAction(id,k,action){
  if(k!==today())return toast('Only today’s timer can be changed.');
  const h=S.habits.find(x=>x.id===id);if(!h)return;
  const key=id+'|'+k;if(timerBusy.has(key))return;
  timerBusy.add(key);
  try{
    await Sync.flush();
    if(saveFailed)throw new Error(syncMsg||'Save your pending changes before using the timer.');
    const response=await Api.timer(id,k,action),result=response.log;
    const L=S.logs[id]=S.logs[id]||{};
    const e=L[k]||(L[k]={v:0,g:result.g});
    e.v=result.v;e.g=result.g;e.duration_seconds=result.duration_seconds;
    e.timer_sessions=result.timer_sessions;
    if(result.timer_started_at)e.timer_started_at=result.timer_started_at;
    else delete e.timer_started_at;
    const previousLevel=S.xp.level;
    if(result.xp)S.xp=result.xp;
    if(action==='reset'){timerCompletionNotified.delete(key);timerExperienceRequests.delete(key)}
    if(!e.v&&!e.note&&!e.duration_seconds&&!e.timer_sessions.length&&!e.timer_started_at)delete L[k];
    if(Sync.snap){
      if(L[k])Sync.snap.logs.set(key,JSON.stringify([
        e.v,e.g,e.note||'',e.duration_seconds||0,e.timer_sessions||[],e.timer_started_at||'',
      ]));
      else Sync.snap.logs.delete(key)
    }
    render();refreshSheet();
    toast(result.xp_gained>0
      ?result.xp.level>previousLevel?'Level up! Level '+result.xp.level+' · +'+result.xp_gained+' XP':'+'+result.xp_gained+' XP earned'
      :action==='start'?(result.duration_seconds?'Timer resumed':'Timer started'):action==='pause'?'Timer paused':action==='stop'?'Timer stopped':'Timer reset');
  }catch(e){toast(e.message||'Could not save timer changes.')}
  finally{timerBusy.delete(key)}
}
function updateCount(id,k,amount){
  if(k!==today())return toast('Only today’s progress can be changed.');
  const h=S.habits.find(x=>x.id===id);if(!h||h.type!=='count')return;
  const was=isDone(h,k),wasAll=allDone();setVal(h,k,val(h,k)+amount);
  const nd=!was&&isDone(h,k);if(nd)toast('Goal reached: '+h.name);save();refresh();
  if(nd){celebrate(id,k,wasAll);dropAlert(id)}
}

/* ---------- events ---------- */
const ACT={
  tab(b,id,k,t){ui.tab=t;ui.sel=null;ui.anim=true;render();$('v').scrollTop=0},
  tg(b,id,k){
    if(k!==today())return toast('Only today’s progress can be changed.');
    const h=S.habits.find(x=>x.id===id);if(!h)return;
    const wasAll=allDone();let nowDone=false;
    if(isDone(h,k)){setVal(h,k,0);toast('Marked not done. That’s okay.')}
    else{nowDone=true;setVal(h,k,goalFor(h,k));const s=streakOf(h).n;toast(k===today()&&[3,7,14,21,30,60,100].includes(s)?s+' in a row on '+h.name+'. Keep it rolling!':'Completed '+h.name)}
    save();refresh();if(nowDone){celebrate(id,k,wasAll);dropAlert(id)}},
  step(b,id,k,t){
    const h=S.habits.find(x=>x.id===id);if(!h)return;
    updateCount(id,k,Number(t)*stepSize(h))},
  'manual-step'(b,id,k){
    const input=b.closest('.hb').querySelector('.qty-input'),amount=Number(input.value);
    if(!Number.isInteger(amount)||amount<1||amount>1000000)return toast('Enter a whole number from 1 to 1,000,000.');
    updateCount(id,k,amount)},
  'timer-action'(b,id,k,action){
    if(k!==today())return toast('Only today’s timer can be changed.');
    const h=S.habits.find(x=>x.id===id);if(!h)return;
    if(action==='reset'&&trackedSeconds(h,k)>0){
      confirmSheet({title:'Reset today’s timer?',body:'This clears all tracked time and sessions for this day.',ok:'Reset timer',danger:true,action:()=>persistTimerAction(id,k,action)});
      return
    }
    persistTimerAction(id,k,action)},
  rem(b,id){const h=S.habits.find(x=>x.id===id);if(!h)return;
    const on=S.prefs.inapp||S.prefs.remind;
    openSheet(`<h1 id="sht" tabindex="-1">Reminder for ${esc(h.name)}</h1><form data-f="rem" data-id="${h.id}"><label for="rt">Remind me at</label><input id="rt" name="remind" type="time" value="${esc(h.remind||'')}" data-first><div class="m" style="margin-top:8px;line-height:1.5">${on?'':'Reminders are currently turned off in Profile. '}The reminder appears while this page is open in a browser tab. It can’t wake a closed app. It only shows on days this habit is planned and not yet done.</div>${S.prefs.remind?'':'<div class="act"><button type="button" class="sm" data-a="remind">'+ic('bell')+'Also use browser notifications</button></div>'}<div class="er" id="er" role="alert"></div><div class="g" style="margin-top:12px"><button class="btn">${h.remind?'Save reminder':'Set reminder'}</button>${h.remind?'<button type="button" class="btn sec" data-a="rem-clear" data-id="'+h.id+'">Remove reminder</button>':''}<button type="button" class="btn sec" data-a="close">Cancel</button></div></form>`,{type:'rem'})},
  'rem-clear'(b,id){const h=S.habits.find(x=>x.id===id);if(!h)return;h.remind='';save();closeSheet();toast('Reminder removed')},
  'test-rem'(){fireReminder({id:'test',name:'your test reminder',type:'check'})},
  'al-done'(b,id){const h=S.habits.find(x=>x.id===id);dropAlert(id);if(h&&!isDone(h,today()))ACT.tg(null,id,today())},
  'al-open'(b,id){dropAlert(id);ui.tab='home';ui.sel=null;if(ui.sheet)closeSheet();ui.anim=true;render();ACT.goto(null,id)},
  'al-snooze'(b,id){snooze[id]=Date.now()+10*60000;dropAlert(id);toast('Snoozed for 10 minutes')},
  'al-x'(b,id){dropAlert(id)},
  note(b,id,k){
    if(k!==today())return toast('Historical notes are read-only.');
    const h=S.habits.find(x=>x.id===id);if(!h)return;const e=getLog(h,k)||{};
    openSheet(`<h1 id="sht" tabindex="-1">Note for ${esc(h.name)}</h1><div class="m">${fmt(k,{weekday:'long',month:'short',day:'numeric'})}</div><form data-f="note" data-id="${h.id}" data-k="${k}"><label for="nt">What helped or got in the way? (optional)</label><textarea id="nt" maxlength="200" data-first>${esc(e.note||'')}</textarea><div class="g" style="margin-top:12px"><button class="btn">Save note</button><button type="button" class="btn sec" data-a="close">Cancel</button></div></form>`,{type:'note',back:ui.sheet})},
  selday(b,id,k){if(k>today())return;ui.sel=k===today()?null:k;render()},
  today(){ui.sel=null;render()},
  filter(b,id,k,t){ui.filter=t;render()},
  add(){openAdd()},
  starter(b,id,k,t){openAdd(STARTERS[Number(t)])},
  demo(){loadDemo()},
  edit(b,id){const h=S.habits.find(x=>x.id===id);if(h)openSheet(formHTML(h),{type:'form'})},
  goto(b,id){const e=document.querySelector(`[data-a="tg"][data-id="${CSS.escape(id)}"][data-k="${today()}"]`);if(e){e.scrollIntoView({behavior:calm()?'auto':'smooth',block:'center'});e.focus({preventScroll:true})}},
  dismiss(b,id){S.dismiss[id]=today();save();render()},
  'dismiss-load'(){loadMsg='';render()},
  arch(b,id){const h=S.habits.find(x=>x.id===id);if(!h)return;h.archived=true;save();closeSheet();toast('Archived '+h.name+'. History is kept.')},
  unarch(b,id){const h=S.habits.find(x=>x.id===id);if(!h)return;h.archived=false;save();if(ui.sheet)closeSheet();else render();toast('Restored '+h.name)},
  del(b,id){const h=S.habits.find(x=>x.id===id);if(!h)return;
    if(hasNonTodayLogs(id))return toast('This habit has read-only history. Archive it to preserve its records.');
    confirmSheet({title:'Delete “'+h.name+'”?',body:'This permanently deletes the habit <b>and all of its history and notes</b>. This can’t be undone. If you just need a break, archive it instead: its history is kept.',ok:'Delete permanently',danger:true,extra:h.archived?'':`<button class="btn sec" data-a="arch" data-id="${h.id}">Archive instead</button>`,action:()=>{S.habits=S.habits.filter(x=>x.id!==id);delete S.logs[id];save();closeSheet();toast('Deleted '+h.name)}})},
  'auth-mode'(){ui.authMode=ui.authMode==='login'?'register':'login';ui.authErr='';render()},
  logout(){doLogout()},
  connect(){connectCode='';healthConnectStatus=null;healthConnectLoading=false;healthConnectError='';connectSheet()},
  async 'connect-generate'(){try{const result=await Api.healthPairing();connectCode=result.code;healthConnectError='';connectSheet()}catch(e){healthConnectError=e.message;connectSheet()}},
  'connect-refresh'(){healthConnectStatus=null;healthConnectError='';refreshHealthConnect()},
  'connect-disconnect'(){confirmSheet({title:'Disconnect Health Connect?',body:'This revokes the Android device’s access and deletes the imported step total from your account.',ok:'Disconnect and delete steps',danger:true,action:async()=>{try{await Api.healthConnectDisconnect();connectCode='';healthConnectStatus={connected:false};healthConnectError='';closeSheet();toast('Health Connect disconnected and imported steps deleted')}catch(e){toast(e.message)}}})},
  async 'connect-copy'(){
    if(!connectCode)return;
    try{await navigator.clipboard.writeText(connectCode);toast('Pairing code copied')}
    catch(e){toast('Could not copy the code. Select it and copy manually.')}},
  'retry-boot'(){bootLoad()},
  'local-import'(){
    const l=localData();ui.localOffer=false;
    if(l&&!S.habits.length){S.habits=l.habits;S.logs=l.logs;if(!S.name)S.name=l.name;save();try{localStorage.setItem(LOCAL_DONE,'1')}catch(e){}toast('Added '+l.habits.length+(l.habits.length===1?' habit':' habits')+' to your account')}
    render()},
  'local-skip'(){ui.localOffer=false;try{localStorage.setItem(LOCAL_DONE,'1')}catch(e){}render()},
  'confirm-yes'(){const f=pending;pending=null;if(f)f()},
  close(){closeSheet()},
  openday(b,id,k){if(!validDate(k))return;openSheet(dayHTML(k),{type:'day',k})},
  mprev(){const m=new Date(ui.month.y,ui.month.m-1,1);ui.month={y:m.getFullYear(),m:m.getMonth()};render()},
  mnext(){const m=new Date(ui.month.y,ui.month.m+1,1);ui.month={y:m.getFullYear(),m:m.getMonth()};render()},
  thismonth(){ui.month=null;render()},
  remind(){setRemind()},
  export(){doExport()},
  import(){$('imp').click()},
  'clear-demo'(){confirmSheet({title:'Remove demo data?',body:'Sample habits with historical records will be archived to preserve their read-only history. Samples without history will be removed.',ok:'Remove demo data',action:()=>{const demos=S.habits.filter(h=>h.demo),remove=demos.filter(h=>!hasNonTodayLogs(h.id)),keep=demos.filter(h=>hasNonTodayLogs(h.id));keep.forEach(h=>h.archived=true);const ids=remove.map(h=>h.id);S.habits=S.habits.filter(h=>!ids.includes(h.id));ids.forEach(i=>delete S.logs[i]);save();closeSheet();toast(keep.length?'Demo habits with history archived; other samples removed.':'Demo data removed')}})},
  reset(){if(S.habits.some(h=>hasNonTodayLogs(h.id)))return toast('Historical records are read-only. Archive habits instead of resetting their history.');confirmSheet({title:'Reset everything?',body:'This permanently deletes <b>all habits, today’s progress, notes, and your name</b> from your account. Your theme, week-start settings, and lifetime XP are kept.',ok:'Delete everything',danger:true,extra:'<button class="btn sec" data-a="export">Export a backup first</button>',action:()=>{const p=S.prefs,xp=S.xp;S=blank();S.xp=xp;S.prefs=Object.assign(p,{remind:false});save();closeSheet();toast('All habit data deleted')}})}
};
document.addEventListener('click',e=>{primeAudio();const b=e.target.closest('[data-a]');if(!b||b.disabled)return;const d=b.dataset;if(ACT[d.a])ACT[d.a](b,d.id,d.k,d.t,e)});
document.addEventListener('submit',e=>{
  const f=e.target.closest('form[data-f]');if(!f)return;e.preventDefault();const t=f.dataset.f;
  if(t==='habit')saveHabit(f);
  else if(t==='note'){const h=S.habits.find(x=>x.id===f.dataset.id),k=f.dataset.k;if(!h||k!==today())return toast('Historical notes are read-only.');
    const txt=f.querySelector('textarea').value.trim().slice(0,200),L=S.logs[h.id]=S.logs[h.id]||{},en=L[k]||{v:0,g:h.goal};
    if(txt)en.note=txt;else delete en.note;L[k]=en;if(en.v===0&&!en.note)delete L[k];save();
    const back=ui.sheet&&ui.sheet.back;if(back&&back.type==='day'){ui.sheet=null;openSheet(dayHTML(back.k),back);render()}else closeSheet();toast(txt?'Note saved':'Note removed')}
  else if(t==='rem'){const h=S.habits.find(x=>x.id===f.dataset.id);if(!h)return;const v=String(new FormData(f).get('remind')||'');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)){$('er').textContent='Pick a time for the reminder.';return}
    h.remind=v;notified.forEach(x=>{if(x.indexOf(h.id)===0)notified.delete(x)});delete snooze[h.id];save();closeSheet();toast('Reminder set for '+fmtTime(v))}
  else if(t==='auth'){authSubmit(f)}
  else if(t==='name'){S.name=f.querySelector('input').value.trim().slice(0,30);save();render();toast(S.name?'Nice to meet you, '+S.name:'Okay')}});
document.addEventListener('change',e=>{
  const t=e.target,f=t.closest&&t.closest('form[data-f="habit"]');
  if(f){syncForm(f);return}
  if(t.id==='th'){S.prefs.theme=['auto','light','dark'].includes(t.value)?t.value:'auto';save();theme()}
  else if(t.id==='ws'){S.prefs.week=t.value==='sun'?'sun':'mon';save();render();toast('Week now starts on '+(S.prefs.week==='sun'?'Sunday':'Monday'))}
  else if(t.id==='nm'){S.name=t.value.trim().slice(0,30);save();toast('Name saved')}
  else if(t.id==='imp'){importFile(t.files&&t.files[0]);t.value=''}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();tick();Sync.pull()}});
