'use strict';
/* ---------- habit coach (Sprig) ---------- */
const COACH_KEY='ht2_coach';
const COACH_TIPS=[
  'Make it tiny. If a habit feels hard, shrink it to a version you can do in two minutes.',
  'Attach it to something you already do, like stretching after you brush your teeth.',
  'Pick a time and place. A clear cue can make starting easier.',
  'Missed a day? That’s normal. Pick it up at the next planned time; there’s no catch-up needed.',
  'Start with your easiest habit. A small win can help build momentum.',
  'Decide your smallest version ahead of time, so a busy day can still count.',
  'Check it off right after you finish, while the win is fresh.',
  'Change one thing at a time. A few manageable habits beat an overwhelming list.',
  'Put what you need where you’ll see it. Make the first step easy to begin.',
  'Pair a new habit with a familiar routine: “After I ___, I will ___.”',
  'If you keep forgetting, move the reminder to a time when you’re usually free.',
  'A short version still counts. Consistency matters more than a perfect session.',
  'Notice what got in the way, then adjust the plan instead of blaming yourself.',
  'Make progress visible: keep a simple note of what you did today.',
  'Plan for busy days with a fallback version that takes less effort.',
  'Celebrate showing up, even when the result is small.'
];
const COACH_SVG='<svg class="cm-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><ellipse class="cm-shadow" cx="32" cy="58.5" rx="15" ry="2.6"/><g class="cm-bob"><g class="cm-sprout"><path class="cm-stem" d="M32 21C32 16 32 14 32.5 11"/><path class="cm-leaf" d="M32.5 12C32 6 25 4 19 6C19 12 25 15 32.5 12Z"/><path class="cm-leaf" d="M32.5 12C33 6 40 3.5 46 6C45.5 12 39 15 32.5 12Z"/></g><path class="cm-body" d="M32 19C46.5 19 55 29.5 55 41C55 52 46.5 58 32 58C17.5 58 9 52 9 41C9 29.5 17.5 19 32 19Z"/><ellipse class="cm-hi" cx="21" cy="29" rx="6" ry="3.2" transform="rotate(-28 21 29)"/><ellipse class="cm-cheek" cx="17.5" cy="46" rx="4" ry="2.6"/><ellipse class="cm-cheek" cx="46.5" cy="46" rx="4" ry="2.6"/><g class="cm-eo"><ellipse cx="24" cy="40" rx="2.7" ry="3.4"/><ellipse cx="40" cy="40" rx="2.7" ry="3.4"/><circle class="cm-glint" cx="25" cy="38.8" r=".9"/><circle class="cm-glint" cx="41" cy="38.8" r=".9"/></g><g class="cm-eh"><path d="M20.8 41Q24 36.6 27.2 41"/><path d="M36.8 41Q40 36.6 43.2 41"/></g><path class="cm-ms" d="M27.5 47.5Q32 52 36.5 47.5"/><path class="cm-mo" d="M27 46.5Q32 47.5 37 46.5Q36.5 53.5 32 53.5Q27.5 53.5 27 46.5Z"/><path class="cm-mc" d="M29 49Q32 50.8 35 49"/></g></svg>';
const coach={open:false,tip:null,ti:Math.floor(Date.now()/864e5)%COACH_TIPS.length,reply:null,react:null,rt:0,act:null};
const coachText=(el,t)=>{if(el&&el.textContent!==t)el.textContent=t};
/* planned days in a row skipped before today, counted only if the habit was completed before that */
function coachGap(h){
  const t=today();
  if(h.freq==='weekly'||h.start>=t||!isSched(h,t))return 0;
  let miss=0;
  for(let i=1;i<60;i++){const k=add(t,-i);if(k<h.start)break;if(isDone(h,k))return miss;if(isSched(h,k))miss++}
  return 0}
function coachEasy(l){
  const sc=h=>{const r=rate(h,30);return(r.pct==null?-1:r.pct)+(h.type==='check'?.5:0)};
  return l.slice().sort((a,b)=>sc(b)-sc(a))[0]}
function coachGoto(id){
  const sw=ui.tab!=='home'||!!ui.sel;ui.tab='home';ui.sel=null;ui.anim=sw;render();ACT.goto(null,id)}
function coachState(){
  const t=today(),nm=S.name;
  if(!S.habits.length)return{mood:'smile',left:0,head:nm?'Hi, '+nm+'. Let’s start small':'Let’s start small',body:'Pick one habit you could do even on a bad day. You can make it bigger later.',act:{label:'Add a small habit',run:()=>openAdd()}};
  const hs=active();
  if(!hs.length)return{mood:'soft',left:0,head:'Taking a break?',body:'All your habits are archived. Restore one, or add a fresh one when you’re ready.',act:{label:'Add a habit',run:()=>openAdd()}};
  const dc=dayCount(t),left=dc.total-dc.done;
  if(!dc.total)return{mood:'soft',left:0,head:'Rest day',body:'Nothing is planned for today. Rest is part of the plan.'};
  if(!left)return{mood:'cheer',left:0,head:'Clean sweep!',body:'All '+dc.done+(dc.done===1?' habit is':' habits are')+' done today. That’s plenty. Enjoy the rest of your day.'};
  const todo=hs.filter(h=>due(h,t)&&!isDone(h,t));
  const part=todo.find(h=>h.type==='count'&&val(h,t)>0);
  const next=part||coachEasy(todo);
  if(!next)return{mood:'smile',left,head:'Small steps count',body:'Whatever you do today is enough.'};
  const show={label:'Show me',run:()=>coachGoto(next.id)};
  const line=part?next.name+' is already '+val(next,t)+' of '+goalFor(next,t)+(next.unit?' '+next.unit:'')+'. A little more and it’s done.':'Next up: '+next.name+'. A smaller version still counts.';
  if(dc.done===0){
    let gap=null;
    todo.forEach(h=>{const m=coachGap(h);if(m>=2&&(!gap||m>gap.m))gap={h,m}});
    if(gap)return{mood:'smile',left,head:'Welcome back',body:'It’s been '+gap.m+' planned days since '+gap.h.name+'. Your earlier progress still counts, and there’s no catch-up needed.',act:{label:'Start again today',run:()=>coachGoto(gap.h.id)}};
    return{mood:'smile',left,head:'Ready when you are',body:line,act:show}}
  return{mood:'smile',left,head:'Nice, '+dc.done+' down',body:left+(left===1?' habit':' habits')+' to go. '+line,act:show}}
function coachSync(){
  const root=$('cm');if(!root)return;
  root.hidden=ui.boot!=='ready';
  if(root.hidden)return;
  const st=coachState(),re=coach.react;
  root.dataset.mood=re?'cheer':st.mood;
  const btn=$('cm-btn'),bd=root.querySelector('.cm-badge'),go=root.querySelector('.cm-go');
  bd.hidden=!(st.left>0)||coach.open;
  coachText(bd,st.left>0?String(st.left):'');
  btn.setAttribute('aria-label',(coach.open?'Close':'Open')+' habit coach'+(st.left>0&&!coach.open?', '+st.left+(st.left===1?' habit':' habits')+' left today':''));
  let head=st.head,body=st.body;
  if(re){head=re.head;body=re.text}
  else if(coach.reply){head=coach.reply.head;body=coach.reply.body}
  else if(coach.tip!==null){head='A small tip';body=COACH_TIPS[coach.tip]}
  coachText($('cm-h'),head);coachText($('cm-b'),body);
  const act=coach.reply?coach.reply.act:st.act;
  const showGo=!!act&&!re;
  go.hidden=!showGo;if(showGo)coachText(go,act.label);
  coach.act=act||null;
  coachText(root.querySelector('.cm-tip'),coach.tip===null?'Give me a tip':'Another tip')}
function coachOpen(focus){
  coach.open=true;coach.tip=null;coach.reply=null;
  try{localStorage.setItem(COACH_KEY,'1')}catch(e){}
  $('cm').classList.add('o');$('cm-btn').setAttribute('aria-expanded','true');
  coachSync();
  if(focus)$('cm-card').focus({preventScroll:true})}
function coachClose(ret){
  if(!coach.open)return;
  coach.open=false;coach.tip=null;coach.reply=null;
  const root=$('cm'),choices=$('cm-choices'),ask=root&&root.querySelector('.cm-ask');
  if(choices)choices.hidden=true;
  if(ask)ask.setAttribute('aria-expanded','false');
  root.classList.remove('o');$('cm-btn').setAttribute('aria-expanded','false');
  coachSync();
  if(ret)$('cm-btn').focus({preventScroll:true})}
function coachReact(id,k,wasAll){
  if(k!==today())return;
  const h=S.habits.find(x=>x.id===id);if(!h)return;
  const dc=dayCount(k),all=dc.total>0&&dc.done===dc.total&&!wasAll;
  const lines=['Nice work on '+h.name+'.',h.name+' is done. Small steps add up.','That counts. '+h.name+' is checked off.'];
  coach.react={head:all?'Clean sweep!':'Nice!',text:all?'Everything planned for today is done. Enjoy the rest of your day.':lines[dc.done%3]};
  const root=$('cm');
  if(root){root.classList.remove('hop');void root.offsetWidth;root.classList.add('hop')}
  clearTimeout(coach.rt);
  coach.rt=setTimeout(()=>{coach.react=null;const r=$('cm');if(r)r.classList.remove('hop');try{coachSync()}catch(e){}},all?3600:2400);
  coachSync()}
function coachInit(){
  const root=document.createElement('div');root.className='cm';root.id='cm';root.dataset.mood='smile';
  root.innerHTML='<div class="cm-card" id="cm-card" role="dialog" aria-labelledby="cm-h" tabindex="-1"><div class="cm-top"><span class="cm-eb">Sprig · habit coach</span><button type="button" class="cm-x" aria-label="Close habit coach"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><p class="cm-h" id="cm-h"></p><p class="cm-b" id="cm-b" aria-live="polite"></p><div class="cm-a"><button type="button" class="cm-go" hidden></button><button type="button" class="cm-tip">Give me a tip</button><button type="button" class="cm-ask" aria-expanded="false" aria-controls="cm-choices">Help me choose</button></div><div class="cm-choices" id="cm-choices" role="group" aria-label="Choose what you need help with" hidden><button type="button" data-coach-choice="smaller">Make it easier</button><button type="button" data-coach-choice="cue">Find a reminder cue</button><button type="button" data-coach-choice="restart">Get back on track</button><button type="button" data-coach-choice="celebrate">Celebrate progress</button></div></div><button type="button" class="cm-btn" id="cm-btn" aria-expanded="false" aria-controls="cm-card" aria-label="Open habit coach">'+COACH_SVG+'<span class="cm-badge" hidden></span></button>';
  $('app').appendChild(root);
  $('cm-btn').addEventListener('click',()=>{coach.open?coachClose(false):coachOpen(true)});
  root.querySelector('.cm-x').addEventListener('click',()=>coachClose(true));
  root.querySelector('.cm-tip').addEventListener('click',()=>{coach.react=null;coach.reply=null;coach.tip=coach.ti;coach.ti=(coach.ti+1)%COACH_TIPS.length;coachSync()});
  root.querySelector('.cm-ask').addEventListener('click',e=>{const choices=root.querySelector('.cm-choices'),show=choices.hidden;choices.hidden=!show;e.currentTarget.setAttribute('aria-expanded',String(show))});
  root.querySelector('.cm-choices').addEventListener('click',e=>{
    const b=e.target.closest('[data-coach-choice]');if(!b)return;
    const todayHabits=active().filter(h=>due(h,today())&&!isDone(h,today()));
    const next=todayHabits[0],name=next?next.name:'a habit that matters to you';
    const messages={
      smaller:{head:'Make it easier to start',body:'Choose the smallest version of '+name+' you could do in two minutes. You can always do more once you begin.'},
      cue:{head:'Find a cue that fits',body:'Try: “After I [something I already do], I will '+name+'.” Choose a routine and place you can repeat.'},
      restart:{head:'A fresh start counts',body:'You don’t need to make up missed days. Pick one small version of '+name+' and begin again today.'},
      celebrate:{head:'That progress counts',body:'Notice what you did, not just what is left. Every check-in is evidence that you showed up.'}
    };
    coach.react=null;coach.tip=null;coach.reply={...messages[b.dataset.coachChoice],act:next?{label:'Show me',run:()=>coachGoto(next.id)}:null};
    coachSync()
  });
  root.querySelector('.cm-go').addEventListener('click',()=>{const a=coach.act;if(!a)return;coachClose(true);a.run()});
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||!coach.open||$('sh').classList.contains('o'))return;
    coachClose(root.contains(document.activeElement))})}
function coachFirstRun(){
  try{if(S.habits.length||ui.localOffer||localStorage.getItem(COACH_KEY))return}catch(e){return}
  setTimeout(()=>{if(!S.habits.length&&!ui.sheet&&!coach.open)coachOpen(false)},1200)}
