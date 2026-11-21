import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';
import {PTS,INV,played,compute,standings,balance,pairHistory,feeDefault,charged,mkAdd} from './engine.js';
const sb=createClient(SUPABASE_URL||'https://x.supabase.co',SUPABASE_ANON_KEY||'x');

const $=id=>document.getElementById(id);
const MES=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIA=['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const SUB='Substituto',OUT='__outro__',MAXJ=14;
const ICONS={classificacao:'M4 20h16M6 16V10M12 16V4M18 16v-8',jogos:'M4 5h16v14H4zM4 10h16M9 5v14',convocatoria:'M8 4h8v3H8zM6 6h12v14H6zM9 12l2 2 4-4',equipas:'M8 8a2.5 2.5 0 1 0 0-.1M16 8a2.5 2.5 0 1 0 0-.1M3 19c0-3 2.5-5 5-5s5 2 5 5M11 19c0-3 2.5-5 5-5s5 2 5 5',pagamentos:'M3 7h18v10H3zM3 11h18M7 15h3',jogadores:'M12 8a3 3 0 1 0 0-.1M5 20c0-4 3-6 7-6s7 2 7 6'};
const TABS=[['classificacao','Tabela','all'],['jogos','Jogos','all'],['convocatoria','Convocatória','all'],['equipas','Equipas','admin'],['pagamentos','Quotas','all'],['jogadores','Jogadores','all']];
const PAPEL={admin:'Administrador',tesoureiro:'Tesoureiro',jogador:'Jogador'};
let me={id:null,email:null},role='anon',perfis=[];
let caixa={},roster=[],acessos={},games=[],conv={},votos={},pags={},pedidos={},campo={};
let fCol=null,tDate=null,loaded=false,editId=null,month=null,pmonth=null,cdate=null,teams=null,tIdx=0,tOpts=[],sel=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=x=>Math.round(x*100)+'%';
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const dobj=d=>new Date(d+'T12:00');
const iso=o=>o.getFullYear()+'-'+String(o.getMonth()+1).padStart(2,'0')+'-'+String(o.getDate()).padStart(2,'0');
const addD=(d,n)=>{const o=dobj(d);o.setDate(o.getDate()+n);return iso(o)};
const fdt=d=>{const[y,m,dd]=d.split('-');return +dd+' '+MES[m-1].slice(0,3).toLowerCase()+' '+y};
const mkey=d=>d.slice(0,7),mname=k=>MES[+k.slice(5)-1]+' '+k.slice(0,4);
const names=n=>n.length?n.length<=2?n.join(' e '):n.slice(0,2).join(', ')+' e mais '+(n.length-2):'—';
const note=t=>$('note').textContent=t||'';
const inRoster=n=>roster.some(r=>r.nome===n);
const isAdm=()=>role==='admin',isTes=()=>role==='admin'||role==='tesoureiro';
const SKDEF=3;const skillOf=n=>{const s=(roster.find(r=>r.nome===n)||{}).skill;return s>=0&&s<=5?s:SKDEF};
const myPlayer=()=>me.id&&acessos[me.id]?acessos[me.id].jogador:null;
function nextThu(from){const o=dobj(from);const d=(4-o.getDay()+7)%7;o.setDate(o.getDate()+d);return iso(o)}
const euro=v=>(Math.round(v*100)/100).toLocaleString('pt-PT')+' €';
async function save(path,data){try{await db.doc(path).set(data);return true}catch(e){note('Não foi possível gravar ('+(e.code||e.message)+'). Verifica se tens permissão de edição.');return false}}

/* ---------- navegação ---------- */
function buildNav(){
  $('nav').innerHTML=TABS.filter(t=>t[2]==='all'||isAdm()).map(([k,l])=>`<a href="#${k}" data-k="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[k]}"/></svg>${l}</a>`).join('');
  for(const e of document.querySelectorAll('.adm'))e.classList.toggle('hide',!isAdm());
  $('who').innerHTML=whoHtml();
  view();
}
function view(){
  const all=['classificacao','jogos','novo','convocatoria','equipas','pagamentos','jogadores'];
  let v=(location.hash||'#classificacao').slice(1);
  if(!all.includes(v)||((v==='novo'||v==='equipas')&&!isAdm()))v='classificacao';
  for(const s of all)$('v-'+s).classList.toggle('hide',s!==v);
  for(const a of $('nav').children)a.classList.toggle('on',a.dataset.k===v||(v==='novo'&&a.dataset.k==='jogos'));
  if(v==='novo'&&!$('fteams').dataset.built)openForm(null);
  if(v==='equipas')renderTeams(true);
}
addEventListener('hashchange',view);

/* ---------- classificação ---------- */
function renderTable(){
  const S=standings(games,roster);
  const last=[...games].filter(played).sort((a,b)=>a.data<b.data?1:-1)[0];
  $('sub').textContent='Época 2026/27 · '+S.total+' jogos'+(last?' · último a '+fdt(last.data):'');
  const mv=s=>{if(s.ant==null)return'';const d=s.ant-s.pos;return d>0?`<span class="mv up">▲${d}</span>`:d<0?`<span class="mv dn">▼${-d}</span>`:'<span class="mv eq">=</span>'};
  $('tab').innerHTML='<thead><tr><th>#</th><th class="l">Jogador</th><th>Pts</th><th>J</th><th>V</th><th>E</th><th>D</th><th>% V</th><th class="hm">Média</th><th class="l">Forma</th><th class="hm">Comp.</th><th class="hm">Cap.</th><th class="hm">+Cap</th><th>Atr.</th></tr></thead><tbody>'+
   S.list.map(s=>`<tr class="${s.pos<=3?'top3':''}"><td class="pos">${s.pos}</td><td class="l">${esc(s.nome)}${mv(s)}${s.ativo?'':'<span class="tag">saiu</span>'}</td><td class="pts">${s.pts}</td><td>${s.J}</td><td>${s.V}</td><td>${s.E}</td><td>${s.D}</td><td>${s.J?pct(s.pv):'—'}</td><td class="hm">${s.media.toFixed(2).replace('.',',')}</td><td class="l"><span class="form">${s.forma.map(r=>`<i class="f${r}">${r}</i>`).join('')||'<span class="tag">sem jogos</span>'}</span></td><td class="hm">${pct(s.comp)}</td><td class="hm">${s.cap}</td><td class="hm">${s.capW}</td><td>${s.atr?'−'+s.atr:'0'}</td></tr>`).join('')+'</tbody>';
  const P=S.prizes,st=S.stats;
  $('prizes').innerHTML=[['1.º prémio · mais pontos',P.p1,v=>v+' pts'],['2.º prémio · maior % de vitórias (mín. '+Math.ceil(P.minJ)+' jogos)',P.p2,pct],['3.º prémio · mais jogos',P.p3,v=>v+' jogos']]
   .map(([t,x,f])=>`<div class="card stat prize"><span>${t}</span><b>${esc(names(x.n))}</b><div>${x.v==null?'—':f(x.v)}</div></div>`).join('');
  $('stats').innerHTML=[['Total de jogos',{v:S.total,n:[]},v=>v],['Mais jogos',st.maisJogos,v=>v],['Menos jogos',st.menosJogos,v=>v],['Mais vitórias',st.maisVit,v=>v],['Menos derrotas',st.menosDerr,v=>v],['Mais derrotas',st.maisDerr,v=>v],['Maior % vitórias',st.maiorPV,pct],['Menor % vitórias',st.menorPV,pct],['Mais vezes capitão',st.maisCap,v=>v],['Convidados por jogo',{v:st.subsJogo,n:[]},v=>v.toFixed(1).replace('.',',')]]
   .map(([t,x,f])=>`<div class="card stat"><span>${t}</span><b>${x.v==null?'—':f(x.v)}</b><div>${esc(x.n.length?names(x.n):'')}</div></div>`).join('');
}

/* ---------- jogos ---------- */
function renderGames(){
  const keys=[...new Set(games.map(g=>mkey(g.data)))].sort();
  if(!keys.length){$('months').innerHTML='';$('mtab').innerHTML='<p>Ainda não há jogos.</p>';$('glist').innerHTML='';return}
  if(!keys.includes(month))month=keys[keys.length-1];
  $('months').innerHTML=keys.map(k=>`<button type="button" data-m="${k}" class="${k===month?'on':''}">${mname(k)}</button>`).join('');
  const mg=games.filter(g=>mkey(g.data)===month).sort((a,b)=>a.data<b.data?-1:1);
  const S=compute(mg,roster),rows=S.list.filter(s=>s.J>0);
  $('mtab').innerHTML=rows.length?`<table><thead><tr><th>#</th><th class="l">Jogador</th><th>Pts</th><th>J</th><th>V</th><th>E</th><th>D</th><th class="hm">+Cap</th><th>Atr.</th></tr></thead><tbody>`+
    rows.map((s,i)=>`<tr><td class="pos">${i+1}</td><td class="l">${esc(s.nome)}</td><td class="pts">${s.pts}</td><td>${s.J}</td><td>${s.V}</td><td>${s.E}</td><td>${s.D}</td><td class="hm">${s.capW}</td><td>${s.atr?'−'+s.atr:'0'}</td></tr>`).join('')+'</tbody></table>':'<p style="margin:0">Sem jogos disputados neste mês.</p>';
  $('mtitle').textContent='Jogos de '+mname(month);
  const resl={V:['Vitória','var(--win)'],E:['Empate','var(--draw)'],D:['Derrota','var(--loss)']};
  const team=(t,r,lbl,atr)=>`<div class="team"><h4>${lbl} <span class="res" style="background:${resl[r][1]}">${resl[r][0]}</span></h4><ol>${t.map((n,i)=>`<li class="${inRoster(n)?'':'g'}">${esc(n)}${i===0?'<span class="cap">C</span>':''}${atr.includes(n)?'<span class="late">atrasado</span>':''}</li>`).join('')}</ol></div>`;
  const acts=g=>isAdm()?`<span class="row"><button class="btn" data-e="${g.id}">Editar</button><button class="btn no" data-d="${g.id}">Apagar</button></span>`:'';
  $('glist').innerHTML=mg.map(g=>g.cancelado?`<div class="card game"><h3>${fdt(g.data)} · Não houve jogo${acts(g)}</h3>${g.motivo?`<p style="margin:0;grid-column:1/-1" class="tag">${esc(g.motivo)}</p>`:''}</div>`:
    `<div class="card game"><h3>${fdt(g.data)}${acts(g)}</h3>${team(g.a,g.r,'Equipa 1'+(g.coletes==='a'?' · coletes':''),g.atr||[])}${team(g.b,INV[g.r],'Equipa 2'+(g.coletes==='b'?' · coletes':''),g.atr||[])}</div>`).join('');
}
$('months').addEventListener('click',e=>{const b=e.target.closest('button');if(b){month=b.dataset.m;renderGames()}});
$('newGame').addEventListener('click',()=>{openForm(null);location.hash='#novo'});
$('glist').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.e){openForm(b.dataset.e);location.hash='#novo';return}
  if(b.dataset.d){
    if(!b.dataset.sure){b.dataset.sure=1;b.textContent='Confirmar?';setTimeout(()=>{if(b.isConnected){delete b.dataset.sure;b.textContent='Apagar'}},4000);return}
    try{await db.doc('jogos/'+b.dataset.d).delete()}catch(err){note('Não foi possível apagar.')}
  }
});

/* ---------- formulário de jogo ---------- */
function opts(sel){
  const act=roster.filter(r=>r.ativo!==false||r.nome===sel).map(r=>r.nome).sort((a,b)=>a.localeCompare(b,'pt'));
  const isOther=sel&&sel!==SUB&&!inRoster(sel);
  return '<option value="">— escolher —</option>'+act.map(n=>`<option${n===sel?' selected':''}>${esc(n)}</option>`).join('')+
   `<option value="${SUB}"${sel===SUB?' selected':''}>Substituto</option><option value="${OUT}"${isOther?' selected':''}>Outro convidado…</option>`;
}
function teamHtml(k,lbl,list){
  let h=`<div><label>${lbl}</label>`;
  for(let i=0;i<7;i++){const n=list[i]||'';const other=n&&n!==SUB&&!inRoster(n);
    h+=`<div class="slot"><span>${i===0?'Capitão':'Jogador '+(i+1)}</span><select data-t="${k}" data-i="${i}" aria-label="${lbl} ${i===0?'capitão':'jogador '+(i+1)}">${opts(n)}</select><input type="text" class="${other?'':'hide'}" data-o="${k}${i}" placeholder="Nome do convidado" value="${other?esc(n):''}"></div>`}
  return h+'</div>';
}
function setPlayed(p){for(const r of document.querySelectorAll('input[name=hj]'))r.checked=r.value===(p?'1':'0');$('fplay').classList.toggle('hide',!p);$('fnoplay').classList.toggle('hide',p)}
function openForm(id,preset){
  editId=id;const g=id?games.find(x=>x.id===id):preset||null;fCol=g&&g.coletes||null;
  $('ftitle').textContent=id?'Editar jogo de '+fdt(g.data):'Novo jogo';
  let d=g&&g.data;
  if(!d){const last=[...games].sort((a,b)=>a.data<b.data?1:-1)[0];d=last?addD(last.data,7):nextThu(today())}
  $('fdate').value=d;
  setPlayed(!(g&&g.cancelado));$('fmot').value=g&&g.motivo||'';
  for(const r of document.querySelectorAll('#fres input'))r.checked=!!(g&&r.value===g.r);
  $('fteams').innerHTML=teamHtml('a','Equipa 1',g&&g.a||[])+teamHtml('b','Equipa 2',g&&g.b||[]);
  $('fteams').dataset.built=1;$('ferr').textContent='';
  lateBoxes(g&&g.atr||[]);
}
function refreshSelects(){
  for(const s of document.querySelectorAll('#fteams select')){
    const o=document.querySelector(`[data-o="${s.dataset.t}${s.dataset.i}"]`);
    const v=s.value===OUT?(o.value.trim()||OUT):s.value;
    s.innerHTML=opts(v===OUT?'':v);if(v===OUT)s.value=OUT;
    o.classList.toggle('hide',s.value!==OUT);
  }
  lateBoxes();
}
function readTeam(k){return [...document.querySelectorAll(`select[data-t="${k}"]`)].map(s=>s.value===OUT?document.querySelector(`[data-o="${k}${s.dataset.i}"]`).value.trim():s.value)}
function lateBoxes(checked){
  const cur=checked||[...document.querySelectorAll('#flate input:checked')].map(i=>i.value);
  const ps=[...readTeam('a'),...readTeam('b')].filter(n=>n&&inRoster(n));
  $('flate').innerHTML=ps.length?ps.map(n=>`<label><input type="checkbox" value="${esc(n)}"${cur.includes(n)?' checked':''}>${esc(n)}</label>`).join(''):'<span class="tag">Escolhe primeiro os jogadores.</span>';
}
for(const r of document.querySelectorAll('input[name=hj]'))r.addEventListener('change',()=>setPlayed(r.value==='1'&&r.checked||(r.value==='0'&&!r.checked)));
$('fteams').addEventListener('change',e=>{
  const s=e.target;if(s.tagName==='SELECT'){const o=document.querySelector(`[data-o="${s.dataset.t}${s.dataset.i}"]`);o.classList.toggle('hide',s.value!==OUT);if(s.value===OUT)o.focus()}
  lateBoxes();
});
$('fteams').addEventListener('input',e=>{if(e.target.dataset.o)lateBoxes()});
$('fcancel').addEventListener('click',()=>{openForm(null);location.hash='#jogos'});
$('f').addEventListener('submit',async e=>{
  e.preventDefault();const err=t=>$('ferr').textContent=t;
  if(!db||!isAdm())return err('Só o administrador pode gravar jogos.');
  const data=$('fdate').value;if(!data)return err('Falta a data.');
  const id='g'+data.replace(/-/g,'');
  if(id!==editId&&games.some(g=>g.id===id))return err('Já existe um registo nessa data. Edita-o na lista de jogos.');
  const houve=document.querySelector('input[name=hj]:checked').value==='1';
  let doc;
  if(!houve)doc={data,cancelado:true,motivo:$('fmot').value.trim()};
  else{
    const r=(document.querySelector('#fres input:checked')||{}).value;
    const a=readTeam('a'),b=readTeam('b');
    if(!r)return err('Falta o resultado da Equipa 1.');
    const miss=[...a,...b].filter(x=>!x).length;
    if(miss)return err('Faltam preencher '+miss+(miss>1?' vagas':' vaga')+'. Usa "Substituto" ou "Outro convidado" se faltou alguém.');
    const all=[...a,...b].filter(n=>n!==SUB);const dup=all.find((n,i)=>all.indexOf(n)!==i);
    if(dup)return err(dup+' aparece mais do que uma vez.');
    doc={data,r,a,b,atr:[...document.querySelectorAll('#flate input:checked')].map(i=>i.value)};if(fCol)doc.coletes=fCol;
  }
  if(await save('jogos/'+id,doc)){
    if(editId&&editId!==id)try{await db.doc('jogos/'+editId).delete()}catch(x){}
    month=mkey(data);openForm(null);location.hash='#jogos';
  }
});

/* ---------- convocatória ---------- */
function presence(date){
  const c=conv[date]||{},man=c.manual||{};
  const map={};
  for(const v of Object.values(votos)){const x=v.v&&v.v[date];if(x&&v.jogador&&(!map[v.jogador]||x.t>map[v.jogador].t))map[v.jogador]=x}
  for(const [n,x] of Object.entries(man))if(!map[n]||x.t>map[n].t)map[n]=x;
  const act=roster.filter(r=>r.ativo!==false).map(r=>r.nome);
  const yes=Object.entries(map).filter(([n,x])=>x.vai&&act.includes(n)).sort((a,b)=>a[1].t-b[1].t).map(e=>e[0]);
  const no=act.filter(n=>map[n]&&!map[n].vai),none=act.filter(n=>!map[n]).sort((a,b)=>a.localeCompare(b,'pt'));
  return {go:yes.slice(0,MAXJ),wait:yes.slice(MAXJ),no,none,map};
}
function renderConv(){
  if(!cdate)cdate=nextThu(today());
  const d=dobj(cdate),g=games.find(x=>x.data===cdate);
  const k=campo,coords=k.lat&&k.lon?`${k.lat}, ${k.lon}`:'';
  const maps=coords?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(k.lat+','+k.lon)}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((k.nome||'')+' '+(k.morada||''))}`;
  const wx=coords?`https://www.windy.com/${k.lat}/${k.lon}?${k.lat},${k.lon},13`:'https://www.ipma.pt/pt/otempo/prev.localidade.hora/#Braga&Braga';
  const diff=Math.round((d-dobj(today()))/864e5);
  $('cweek').textContent=diff===0?'Hoje':diff>0?'Daqui a '+diff+(diff===1?' dia':' dias'):'Há '+(-diff)+' dias';
  $('ticket').innerHTML=`<div class="day"><span>${DIA[d.getDay()]}</span><b>${d.getDate()}</b><span>${MES[d.getMonth()].slice(0,3)} · 21h00</span></div>
   <div><h2>${g?g.cancelado?'Não houve jogo':'Jogo disputado':'Próximo jogo'}</h2><p><b>${esc(k.nome||'Campo FUT7')}</b> · Futebol 7 · Palmeira</p><p>${esc(k.morada||'')}</p>
   <p>${coords?'Coordenadas: '+esc(coords)+' · ':''}<a href="${esc(maps)}" target="_blank" rel="noopener">Abrir no mapa</a></p>
   <p>Tempo previsto: <a href="${esc(wx)}" target="_blank" rel="noopener">ver previsão para quinta às 21h</a></p></div>`;
  const P=presence(cdate),mp=myPlayer(),mine=mp&&P.map[mp];
  const closed=!!g||diff<0;
  $('mine').innerHTML=!me.id?'<p style="margin:0">Inicia sessão para responder à convocatória.</p>':!mp?'<p style="margin:0">A tua conta ainda não está associada a um jogador. Pede acesso no topo da Tabela.</p>':
   `<div class="row" style="justify-content:space-between"><div><b>${esc(mp)}</b>, vais jogar?<br><span class="tag" style="margin:0">${mine?mine.vai?(P.go.includes(mp)?'Estás confirmado.':'Estás em lista de espera (suplente).'):'Disseste que não vais.':'Ainda não respondeste.'}</span></div>
   <div class="row"><button class="btn ${mine&&mine.vai?'ok':''}" data-v="1" ${closed?'disabled':''}>Vou</button><button class="btn ${mine&&!mine.vai?'pri':''}" data-v="0" ${closed?'disabled':''}>Não vou</button></div></div>`;
  $('ccount').textContent=P.go.length+'/'+MAXJ;
  const ctl=n=>isAdm()&&!closed?`<span class="mini"><button class="btn" data-m="${esc(n)}" data-x="1" aria-label="${esc(n)} vai">✓</button><button class="btn" data-m="${esc(n)}" data-x="0" aria-label="${esc(n)} não vai">✕</button></span>`:'';
  $('cyes').innerHTML=P.go.map((n,i)=>`<li><span><span class="dot y"></span>${i+1}. ${esc(n)}</span>${ctl(n)}</li>`).join('')||'<li class="tag">Ainda ninguém confirmou.</li>';
  $('cwaitH').classList.toggle('hide',!P.wait.length);
  $('cwait').innerHTML=P.wait.map(n=>`<li><span><span class="dot w"></span>${esc(n)}</span>${ctl(n)}</li>`).join('');
  $('cno').innerHTML=[...P.no.map(n=>`<li><span><span class="dot n"></span>${esc(n)}</span>${ctl(n)}</li>`),...P.none.map(n=>`<li><span><span class="dot"></span>${esc(n)} <span class="tag">sem resposta</span></span>${ctl(n)}</li>`)].join('');
  const t=(conv[cdate]||{}).equipas;
  $('cteams').classList.toggle('hide',!t);
  if(t)$('cteams').innerHTML=`<h2 style="margin-top:0">Equipas</h2><div class="pitch">${[['Equipa 1',t.a,'a'],['Equipa 2',t.b,'b']].map(([l,x,k])=>`<div class="side" style="${t.coletes===k?'border-color:var(--gold)':''}"><h3>${l}<span class="bib ${t.coletes===k?'on':''}">${t.coletes?t.coletes===k?'De coletes':'Sem coletes':''}</span></h3><ol style="margin:0;padding-left:20px">${x.map((n,i)=>`<li>${esc(n)}${i===0?'<span class="cap">C</span>':''}</li>`).join('')}</ol></div>`).join('')}</div>`;
}
$('cprev').addEventListener('click',()=>{cdate=addD(cdate||nextThu(today()),-7);renderConv()});
$('cnext').addEventListener('click',()=>{cdate=addD(cdate||nextThu(today()),7);renderConv()});
$('mine').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||!me.id)return;
  const cur=votos[me.id]||{},v={...(cur.v||{})};v[cdate]={vai:b.dataset.v==='1',t:Date.now()};
  b.disabled=true;await save('votos/'+me.id,{jogador:myPlayer(),v});b.disabled=false;
});
$('v-convocatoria').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-m]');if(!b||!isAdm())return;
  const c=conv[cdate]||{},man={...(c.manual||{})};man[b.dataset.m]={vai:b.dataset.x==='1',t:Date.now()};
  await save('conv/'+cdate,{...c,manual:man});
});
$('ksave').addEventListener('click',async()=>{
  const la=$('kla').value.trim().replace(',','.'),lo=$('klo').value.trim().replace(',','.');
  if((la||lo)&&(isNaN(+la)||isNaN(+lo)))return $('kmsg').textContent='Coordenadas inválidas.';
  if(await save('config/campo',{nome:$('kn').value.trim(),morada:$('km').value.trim(),lat:la,lon:lo}))$('kmsg').textContent='Guardado.';
});

/* ---------- equipas ---------- */
function capCounts(){const c={};for(const g of games.filter(played))for(const t of [g.a,g.b])c[t[0]]=(c[t[0]]||0)+1;return c}
function withCaptain(t){
  const cc=capCounts();const real=t.filter(p=>p.nome!==SUB);
  if(!real.length)return t;
  const c=[...real].sort((x,y)=>(cc[x.nome]||0)-(cc[y.nome]||0)||y.skill-x.skill)[0];
  return [c,...t.filter(p=>p!==c)];
}
function buildTeams(prev){
  if(!cdate)cdate=nextThu(today());tDate=cdate;
  const P=presence(cdate);
  const pl=P.go.map(n=>({nome:n,skill:skillOf(n)}));
  const avg=pl.length?Math.round(pl.reduce((s,p)=>s+p.skill,0)/pl.length):SKDEF;
  while(pl.length<MAXJ)pl.push({nome:SUB,skill:avg});
  tOpts=balance(pl,pairHistory(games,roster));
  const top=Math.min(6,tOpts.length);
  do{tIdx=Math.floor(Math.random()*top)}while(top>1&&tIdx===prev);
  setTeam();
}
function setTeam(){const o=tOpts[tIdx];teams={a:withCaptain(o.a),b:withCaptain(o.b),n:presence(cdate).go.join('|')};sel=null;renderTeams(true)}
function renderTeams(keep){
  if(!loaded)return;
  if(!cdate)cdate=nextThu(today());
  const P=presence(cdate),subs=MAXJ-Math.min(P.go.length,MAXJ);
  for(const id of ['eother','esave','egame'])$(id).disabled=!P.go.length;
  if(!P.go.length){teams=null;$('etitle').textContent='Equipas para '+fdt(cdate);$('einfo').textContent='';
    $('epitch').innerHTML='<div class="card" style="grid-column:1/-1"><p style="margin:0">Ainda ninguém confirmou presença para este jogo. As equipas são feitas só com quem disse que vai, por isso confirma primeiro os jogadores na <a href="#convocatoria">Convocatória</a>.</p></div>';return}
  if(!keep||!teams||tDate!==cdate||teams.n!==P.go.join('|'))buildTeams();
  $('etitle').textContent='Equipas para '+fdt(cdate);
  const lastG=[...games].filter(played).sort((a,b)=>a.data<b.data?1:-1)[0];
  let kept=0;if(lastG){const same=(x,y)=>(teams.a.some(p=>p.nome===x)&&teams.a.some(p=>p.nome===y))||(teams.b.some(p=>p.nome===x)&&teams.b.some(p=>p.nome===y));
    for(const t of [lastG.a,lastG.b])for(let i=0;i<t.length;i++)for(let j=i+1;j<t.length;j++)if(t[i]!==SUB&&t[j]!==SUB&&same(t[i],t[j]))kept++}
  $('einfo').textContent=P.go.length+' confirmados'+(subs?' · faltam '+subs+', preenchidos com Substituto':'')+(lastG?' · '+kept+' dupla'+(kept===1?'':'s')+' repetida'+(kept===1?'':'s')+' do último jogo':'');
  const sum=t=>t.reduce((s,p)=>s+p.skill,0);
  $('epitch').innerHTML=[['a','Equipa 1'],['b','Equipa 2']].map(([k,l])=>`<div class="side"><h3>${l}<span class="num">skill ${sum(teams[k])}</span></h3>${teams[k].map((p,i)=>`<button type="button" class="pl ${sel&&sel.k===k&&sel.i===i?'sel':''}" data-k="${k}" data-i="${i}"><span>${esc(p.nome)}${i===0&&p.nome!==SUB?'<span class="cap">C</span>':''}</span><small>${p.skill}</small></button>`).join('')}</div>`).join('');
}
$('epitch').addEventListener('click',e=>{
  const b=e.target.closest('.pl');if(!b)return;const k=b.dataset.k,i=+b.dataset.i;
  if(!sel||sel.k===k){sel=sel&&sel.k===k&&sel.i===i?null:{k,i};renderTeams(true);return}
  const o=sel.k;const x=teams[o][sel.i];teams[o][sel.i]=teams[k][i];teams[k][i]=x;
  teams.a=withCaptain(teams.a);teams.b=withCaptain(teams.b);sel=null;renderTeams(true);
});
$('eother').addEventListener('click',()=>buildTeams(tIdx));
$('esave').addEventListener('click',async()=>{const c=conv[cdate]||{};const col=Math.random()<.5?'a':'b';
  if(await save('conv/'+cdate,{...c,equipas:{a:teams.a.map(p=>p.nome),b:teams.b.map(p=>p.nome),coletes:col}}))$('eerr').textContent='Publicado na convocatória. Sorteio: a '+(col==='a'?'Equipa 1':'Equipa 2')+' joga de coletes.'});
$('egame').addEventListener('click',()=>{const pub=(conv[cdate]||{}).equipas;openForm(null,{data:cdate,a:teams.a.map(p=>p.nome),b:teams.b.map(p=>p.nome),coletes:pub&&pub.coletes});location.hash='#novo'});

/* ---------- pagamentos ---------- */
const PSTART='2025-12';
function monthsList(){const out=[];let k=PSTART;const now=mkey(today());while(k<=now){out.push(k);k=mkAdd(k,1)}return out}
const feeOf=k=>pags[k]&&pags[k].valor!=null?pags[k].valor:feeDefault(k);
const XT={campo:'Pagamento do campo',jantar:'Jantar',bola:'Bola / material',outra:'Outra despesa',entrada:'Outra entrada'};
function cellState(r,k){const d=pags[k]||{};if(!charged(r,k))return'fora';if((d.isentos||[]).includes(r.nome))return'isento';return d.pagos&&d.pagos[r.nome]?'pago':'falta'}
function ledger(){
  const ms=monthsList(),deb={},cash=[];let owe=0,saldo=+(caixa.saldoInicial||0);
  for(const k of ms){const d=pags[k]||{};let rec=0;
    for(const r of roster){const s=cellState(r,k);
      if(s==='pago')rec+=d.pagos[r.nome].valor??feeOf(k);
      else if(s==='falta'){owe+=feeOf(k);(deb[r.nome]=deb[r.nome]||[]).push(k)}}
    const xs=d.mov||[],sum=f=>xs.filter(f).reduce((s,x)=>s+x.valor,0);
    const ent=sum(x=>x.tipo==='entrada'),campoV=sum(x=>x.tipo==='campo'),outV=sum(x=>x.tipo!=='campo'&&x.tipo!=='entrada');
    const dif=rec+ent-campoV-outV;saldo+=dif;cash.push({k,rec,ent,campo:campoV,out:outV,dif});}
  return {ms,deb,owe,cash,saldo:Math.round(saldo*100)/100};
}
const mshort=k=>MES[+k.slice(5)-1].slice(0,3).toLowerCase()+' '+k.slice(2,4);
function renderPay(){
  const L=ledger(),mp=myPlayer(),cur=L.ms[L.ms.length-1];
  $('pmine').classList.toggle('hide',!mp);
  if(mp){const d=L.deb[mp]||[];$('pmine').innerHTML=`<h2 style="margin:0 0 4px">As minhas quotas</h2>${d.length?`<p class="owe" style="margin:0">Deves ${euro(d.reduce((s,k)=>s+feeOf(k),0))}: ${d.map(mname).join(', ')}</p>`:'<p class="paid" style="margin:0">Tens tudo pago.</p>'}`}
  const tes=isTes();
  for(const e of document.querySelectorAll('.pay'))e.classList.toggle('hide',!tes);
  $('psum').classList.toggle('hide',!tes);
  if(!tes)return;
  const cc=L.cash[L.cash.length-1]||{rec:0};
  const due=roster.filter(r=>['pago','falta'].includes(cellState(r,cur)));const paidN=due.filter(r=>cellState(r,cur)==='pago').length;
  $('psum').innerHTML=[['Saldo em caixa',euro(L.saldo),L.saldo<0?'owe':''],['Quotas em dívida',euro(L.owe),'owe'],[mname(cur),paidN+'/'+due.length+' pagaram',''],['Recebido em '+MES[+cur.slice(5)-1].toLowerCase(),euro(cc.rec),'']]
    .map(([t,v,c])=>`<div class="card stat"><span>${t}</span><b class="${c}">${v}</b></div>`).join('');
  /* grelha jogador × mês */
  const rs=roster.filter(r=>L.ms.some(k=>cellState(r,k)!=='fora')).sort((a,b)=>(b.ativo!==false)-(a.ativo!==false));
  $('pgrid').innerHTML=`<thead><tr><th class="l">Jogador</th>${L.ms.map(k=>`<th>${mshort(k)}<br><span class="tag" style="margin:0">${euro(feeOf(k))}</span></th>`).join('')}</tr></thead><tbody>`+
    rs.map(r=>`<tr><td class="l">${esc(r.nome)}${r.ativo===false?'<span class="tag">saiu</span>':''}</td>${L.ms.map(k=>{const s=cellState(r,k),p=((pags[k]||{}).pagos||{})[r.nome];
      return `<td><button type="button" class="pc ${s}" data-c="${esc(r.nome)}" data-k="${k}" ${s==='fora'?'disabled':''} title="${s==='pago'&&p.data?'Pago a '+fdt(p.data):''}">${s==='pago'?euro(p.valor??feeOf(k)):s==='falta'?'Em falta':'–'}</button></td>`}).join('')}</tr>`).join('')+
    `</tbody><tfoot><tr><th class="l">Total</th>${L.cash.map(c=>`<th>${euro(c.rec)}</th>`).join('')}</tr></tfoot>`;
  const w=$('pgridW');if(!w.dataset.s){w.dataset.s=1;requestAnimationFrame(()=>w.scrollLeft=w.scrollWidth)}
  /* caixa */
  $('pcash').innerHTML=`<thead><tr><th class="l">Mês</th><th>Quotas</th><th>Outras entradas</th><th>Campo</th><th>Despesas</th><th>Diferença</th></tr></thead><tbody>`+
    [...L.cash].reverse().map(c=>`<tr><td class="l">${mshort(c.k)}</td><td>${euro(c.rec)}</td><td>${c.ent?euro(c.ent):'–'}</td><td>${c.campo?'−'+euro(c.campo):'–'}</td><td>${c.out?'−'+euro(c.out):'–'}</td><td class="${c.dif<0?'owe':'paid'}">${euro(c.dif)}</td></tr>`).join('')+
    `<tr><td class="l">Saldo inicial</td><td colspan="4" class="tag" style="text-align:left">antes de ${mname(PSTART).toLowerCase()}</td><td>${euro(+(caixa.saldoInicial||0))}</td></tr></tbody><tfoot><tr><th class="l">Saldo</th><th colspan="4"></th><th class="${L.saldo<0?'owe':'paid'}">${euro(L.saldo)}</th></tr></tfoot>`;
  if(document.activeElement!==$('psi'))$('psi').value=+(caixa.saldoInicial||0);
  /* devedores */
  const dl=Object.entries(L.deb).sort((a,b)=>b[1].reduce((s,k)=>s+feeOf(k),0)-a[1].reduce((s,k)=>s+feeOf(k),0)||a[0].localeCompare(b[0],'pt'));
  $('pdebt').innerHTML=dl.map(([n,ks])=>`<li><span>${esc(n)}<br><span class="tag" style="margin:0">${ks.map(mshort).join(', ')}</span></span><span class="owe">${euro(ks.reduce((s,k)=>s+feeOf(k),0))}</span></li>`).join('')||'<li class="paid">Ninguém deve nada.</li>';
  /* valor da quota */
  const pv=$('pvm').value||cur;$('pvm').innerHTML=[...L.ms,mkAdd(cur,1)].map(k=>`<option value="${k}"${k===pv?' selected':''}>${mname(k)}</option>`).join('');
  if(document.activeElement!==$('pval'))$('pval').value=feeOf($('pvm').value);
  /* saídas */
  const xs=L.ms.flatMap(k=>((pags[k]||{}).mov||[]).map((x,i)=>({...x,k,i}))).sort((a,b)=>a.data<b.data?1:-1);
  $('xlist').innerHTML=xs.map(x=>`<li><span>${esc(XT[x.tipo]||'Despesa')}${x.desc?' · '+esc(x.desc):''}<br><span class="tag" style="margin:0">${fdt(x.data)}</span></span><span class="mini"><span class="${x.tipo==='entrada'?'paid':'owe'}">${x.tipo==='entrada'?'+':'−'}${euro(x.valor)}</span><button class="btn no" data-xk="${x.k}" data-xi="${x.i}" aria-label="Apagar">✕</button></span></li>`).join('')||'<li class="tag">Sem saídas registadas.</li>';
  if(!$('xd').value)$('xd').value=today();
}
$('psisave').addEventListener('click',async()=>{const v=Math.round(+$('psi').value*100)/100;if(isNaN(v))return;await save('config/caixa',{...caixa,saldoInicial:v})});
$('pvm').addEventListener('change',()=>{$('pval').value=feeOf($('pvm').value)});
$('pvalsave').addEventListener('click',async()=>{const k=$('pvm').value,v=+$('pval').value;if(!(v>=0))return;const c=pags[k]||{};
  const p={...(c.pagos||{})};for(const n of Object.keys(p))if(p[n].valor===feeOf(k))p[n]={...p[n],valor:v};
  if(await save('pagamentos/'+k,{...c,valor:v,pagos:p}))$('pvmsg').textContent='Quota de '+mname(k)+' = '+euro(v)});
$('pgrid').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-c]');if(!b||!isTes())return;
  const n=b.dataset.c,k=b.dataset.k,c=pags[k]||{},p={...(c.pagos||{})};let isen=[...(c.isentos||[])];
  const r=roster.find(x=>x.nome===n),s=cellState(r,k);
  if(s==='falta')p[n]={valor:feeOf(k),data:today()};
  else if(s==='pago'){delete p[n];isen.push(n)}
  else if(s==='isento')isen=isen.filter(x=>x!==n);
  b.disabled=true;await save('pagamentos/'+k,{...c,pagos:p,isentos:isen});
});
$('xadd').addEventListener('click',async()=>{
  const data=$('xd').value,valor=Math.round(+$('xv').value*100)/100,tipo=$('xt').value;
  if(!data||!(valor>0))return $('xmsg').textContent='Indica a data e o valor.';
  const k=mkey(data),c=pags[k]||{};
  if(await save('pagamentos/'+k,{...c,mov:[...(c.mov||[]),{tipo,desc:$('xn').value.trim(),data,valor}]})){$('xv').value='';$('xn').value='';$('xmsg').textContent='Registado em '+mname(k)+'.'}
});
$('xlist').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-xk]');if(!b)return;
  if(!b.dataset.sure){b.dataset.sure=1;b.textContent='Apagar?';return}
  const k=b.dataset.xk,c=pags[k]||{},xs=[...(c.mov||[])];xs.splice(+b.dataset.xi,1);await save('pagamentos/'+k,{...c,mov:xs});
});

/* ---------- jogadores e acessos ---------- */
const skOpts=v=>Array.from({length:6},(_,i)=>`<option${i===v?' selected':''}>${i}</option>`).join('');
$('rsk').innerHTML=skOpts(SKDEF);
function renderRoster(){
  const S=compute(games,roster),J=Object.fromEntries(S.list.map(s=>[s.nome,s.J]));
  const rs=[...roster].sort((a,b)=>(b.ativo!==false)-(a.ativo!==false)||a.nome.localeCompare(b.nome,'pt'));
  $('rtab').innerHTML=`<thead><tr><th class="l">Nome</th><th>Jogos</th>${isAdm()?'<th>Skill 0–5</th><th></th>':''}</tr></thead><tbody>`+rs.map(r=>`<tr><td class="l">${esc(r.nome)}${r.ativo===false?'<span class="tag">saiu</span>':''}</td><td>${J[r.nome]||0}</td>${isAdm()?`<td><select data-sk="${esc(r.nome)}" style="width:4.5em" aria-label="Skill de ${esc(r.nome)}">${skOpts(skillOf(r.nome))}</select></td><td><button class="btn" data-n="${esc(r.nome)}">${r.ativo===false?'Voltou':'Saiu'}</button></td>`:''}</tr>`).join('')+'</tbody>';
  if(!isAdm())return;
  renderAccess();
  $('bk').value=JSON.stringify({plantel:roster,jogos:[...games].sort((a,b)=>a.data<b.data?-1:1).map(({id,...g})=>g),pagamentos:pags,campo,caixa});
}
function renderAccess(){
  const nm=id=>{const p=perfis.find(x=>x.user_id===id);return p?p.email||'(sem email)':'?'};
  const plOpts=v=>'<option value="">— jogador —</option>'+roster.filter(r=>r.ativo!==false).map(r=>`<option${r.nome===v?' selected':''}>${esc(r.nome)}</option>`).join('');
  const roleOpts=v=>Object.entries(PAPEL).map(([k,l])=>`<option value="${k}"${k===v?' selected':''}>${l}</option>`).join('');
  const ped=perfis.filter(p=>!p.papel);
  $('aped').innerHTML=ped.map(p=>`<li style="flex-wrap:wrap"><span>${esc(p.email)}<br><span class="tag" style="margin:0">${p.jogador_pedido?'diz ser '+esc(p.jogador_pedido):'ainda não escolheu o nome'}</span></span><span class="mini" style="flex-wrap:wrap"><select data-pj="${p.user_id}" style="width:10em" aria-label="Jogador">${plOpts(p.jogador_pedido)}</select><select data-pr="${p.user_id}" style="width:9em" aria-label="Perfil">${roleOpts('jogador')}</select><button class="btn ok" data-ap="${p.user_id}">Aprovar</button></span></li>`).join('')||'<li class="tag">Sem pedidos.</li>';
  $('alist').innerHTML=perfis.filter(p=>p.papel).map(p=>{const self=p.user_id===me.id;return `<li style="flex-wrap:wrap"><span>${esc(nm(p.user_id))}${self?' <span class="tag">(tu)</span>':''}</span><span class="mini" style="flex-wrap:wrap"><select data-aj="${p.user_id}" style="width:10em" aria-label="Jogador">${plOpts(p.jogador)}</select>${self?'<span class="tag">Administrador</span>':`<select data-ar="${p.user_id}" style="width:9em" aria-label="Perfil">${roleOpts(p.papel)}</select><button class="btn no" data-ax="${p.user_id}">Remover</button>`}</span></li>`}).join('');
}
async function updPerfil(id,patch){const{error}=await sb.from('perfis').update(patch).eq('user_id',id);if(error){note('Não foi possível gravar: '+error.message);return false}await loadPerfis();refresh();return true}
$('rtab').addEventListener('change',async e=>{const s=e.target;if(!s.dataset.sk)return;await save('config/plantel',{roster:roster.map(r=>r.nome===s.dataset.sk?{...r,skill:+s.value}:r)})});
$('rtab').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||!b.dataset.n)return;const mk=mkey(today());
  await save('config/plantel',{roster:roster.map(r=>r.nome===b.dataset.n?(r.ativo===false?{...r,ativo:true,saida:null,desde:r.desde&&r.desde>mk?mk:r.desde||null}:{...r,ativo:false,saida:mk}):r)})});
$('radd').addEventListener('click',async()=>{const n=$('rnew').value.trim().replace(/\s+/g,' ');
  if(!n)return $('rerr').textContent='Escreve o nome.';if(roster.some(r=>r.nome.toLowerCase()===n.toLowerCase()))return $('rerr').textContent='Esse nome já existe.';
  if(n.toLowerCase()===SUB.toLowerCase())return $('rerr').textContent='Nome reservado.';
  if(await save('config/plantel',{roster:[...roster,{nome:n,ativo:true,skill:+$('rsk').value,desde:mkey(today())}]})){$('rnew').value='';$('rerr').textContent=''}});
$('v-jogadores').addEventListener('change',async e=>{const s=e.target;
  if(s.dataset.aj)await updPerfil(s.dataset.aj,{jogador:s.value||null});
  if(s.dataset.ar)await updPerfil(s.dataset.ar,{papel:s.value});});
$('v-jogadores').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.ap){const id=b.dataset.ap,j=document.querySelector(`[data-pj="${id}"]`).value;
    if(!j)return note('Escolhe o jogador antes de aprovar.');
    await updPerfil(id,{papel:document.querySelector(`[data-pr="${id}"]`).value,jogador:j})}
  if(b.dataset.ax){if(!b.dataset.sure){b.dataset.sure=1;b.textContent='Confirmar?';return}await updPerfil(b.dataset.ax,{papel:null,jogador:null})}});
$('bcopy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('bk').value);$('berr').textContent='Copiado.'}catch(x){$('bk').select();$('berr').textContent='Seleciona e copia à mão.'}});
$('brest').addEventListener('click',async e=>{
  const b=e.target;if(!b.dataset.sure){b.dataset.sure=1;b.textContent='Substituir tudo?';return}
  delete b.dataset.sure;b.textContent='Restaurar';
  try{const o=JSON.parse($('bk').value);if(!Array.isArray(o.plantel)||!Array.isArray(o.jogos))throw 0;
    const rows=[{col:'config',id:'plantel',data:{roster:o.plantel}},...o.jogos.map(g=>({col:'jogos',id:'g'+g.data.replace(/-/g,''),data:g})),
      ...Object.entries(o.pagamentos||{}).map(([k,v])=>({col:'pagamentos',id:k,data:v}))];
    if(o.campo)rows.push({col:'config',id:'campo',data:o.campo});if(o.caixa)rows.push({col:'config',id:'caixa',data:o.caixa});
    const{error}=await sb.from('docs').upsert(rows);if(error)throw error;await loadDocs();refresh();
    $('berr').textContent='Restaurado: '+o.jogos.length+' jogos.';
  }catch(x){$('berr').textContent='Texto inválido ou falha ao gravar.'}
});

/* ---------- pedido de acesso ---------- */
function renderAsk(){
  const box=$('askAccess'),p=perfis.find(x=>x.user_id===me.id);
  const need=!!me.id&&(!p||!p.papel);
  box.classList.toggle('hide',!need);
  if(!need)return;
  box.innerHTML=p&&p.jogador_pedido?`<p style="margin:0">Pedido enviado como <b>${esc(p.jogador_pedido)}</b>. Aguarda aprovação do administrador.</p>`:
   `<h2 style="margin:0 0 4px">Quem és?</h2><p style="margin:0 0 8px">Escolhe o teu nome para pedir acesso. O administrador aprova e define o teu perfil.</p><div class="row"><select id="askSel" style="max-width:18em">${'<option value="">— escolher —</option>'+roster.filter(r=>r.ativo!==false).map(r=>`<option>${esc(r.nome)}</option>`).join('')}</select><button class="btn pri" id="askBtn" type="button">Pedir acesso</button></div>`;
}
$('askAccess').addEventListener('click',async e=>{if(e.target.id!=='askBtn')return;const v=$('askSel').value;if(!v)return;
  const{error}=await sb.rpc('pedir_acesso',{j:v});if(error)return note('Não foi possível enviar o pedido: '+error.message);await loadPerfis();refresh()});

/* ---------- dados (Supabase) ---------- */
let store={};
const db={doc(path){const[col,id]=path.split('/');return{
  async set(data){const{error}=await sb.from('docs').upsert({col,id,data});if(error)throw error;put(col,id,data)},
  async delete(){const{error}=await sb.from('docs').delete().eq('col',col).eq('id',id);if(error)throw error;put(col,id,null)}}}};
function put(col,id,data){(store[col]=store[col]||{});if(data==null)delete store[col][id];else store[col][id]=data;apply()}
async function loadDocs(){const{data,error}=await sb.from('docs').select('col,id,data');if(error)throw error;store={};for(const r of data)(store[r.col]=store[r.col]||{})[r.id]=r.data;apply()}
async function loadPerfis(){const{data}=await sb.from('perfis').select('user_id,email,jogador,jogador_pedido,papel');perfis=data||[];
  const mine=perfis.find(p=>p.user_id===me.id);acessos={};for(const p of perfis)if(p.papel)acessos[p.user_id]={jogador:p.jogador,papel:p.papel};if(mine&&mine.papel)acessos[me.id]={jogador:mine.jogador,papel:mine.papel}}
const DEFCAMPO={nome:'Campo FUT7',morada:'Rua de Entrecampos 91, 4700-700 Braga'};
let campoKey='';
function apply(){
  const c=store.config||{};
  roster=(c.plantel&&c.plantel.roster)||[];caixa=c.caixa||{};campo=c.campo||DEFCAMPO;
  const ck=JSON.stringify(campo);if(ck!==campoKey){campoKey=ck;$('kn').value=campo.nome||'';$('km').value=campo.morada||'';$('kla').value=campo.lat||'';$('klo').value=campo.lon||''}
  games=Object.entries(store.jogos||{}).map(([id,d])=>({id,...d}));
  conv={...(store.conv||{})};votos={...(store.votos||{})};pags={...(store.pagamentos||{})};
  refresh();
}

/* ---------- arranque e login ---------- */
function computeRole(){role=me.id&&acessos[me.id]?acessos[me.id].papel||'jogador':me.id?'pendente':'anon'}
let lastRole=null;
function refresh(){
  if(!loaded)return;
  computeRole();if(role!==lastRole){lastRole=role;buildNav()}
  else $('who').innerHTML=whoHtml();
  renderAsk();renderTable();renderGames();renderConv();renderPay();renderRoster();refreshSelects();
}
const whoHtml=()=>me.id?`<b>${esc(myPlayer()||me.email||'')}</b>${PAPEL[role]||'Sem acesso aprovado'} · <button class="linkbtn" data-out>Sair</button>`:'';
document.addEventListener('click',async e=>{if(e.target.closest('[data-out]')){await sb.auth.signOut();location.reload()}});
function showLogin(mode){
  $('login').classList.remove('hide');$('app').classList.add('hide');
  $('lmode').dataset.m=mode||'entrar';
  const m=$('lmode').dataset.m;
  $('ltitle').textContent={entrar:'Entrar',criar:'Criar conta',recuperar:'Recuperar password',nova:'Nova password'}[m];
  $('lemailW').classList.toggle('hide',m==='nova');$('lpassW').classList.toggle('hide',m==='recuperar');
  $('lgo').textContent={entrar:'Entrar',criar:'Criar conta',recuperar:'Enviar email',nova:'Guardar password'}[m];
  $('llinks').classList.toggle('hide',m==='nova');$('lmsg').textContent='';
}
$('llinks').addEventListener('click',e=>{const b=e.target.closest('[data-m]');if(b)showLogin(b.dataset.m)});
$('lform').addEventListener('submit',async e=>{
  e.preventDefault();const m=$('lmode').dataset.m,email=$('lemail').value.trim(),password=$('lpass').value;const msg=t=>$('lmsg').textContent=t;
  let r;
  if(m==='entrar')r=await sb.auth.signInWithPassword({email,password});
  if(m==='criar'){if(password.length<8)return msg('A password precisa de pelo menos 8 caracteres.');r=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin}});
    if(!r.error&&!r.data.session)return msg('Conta criada. Confirma o teu email (vê a caixa de correio) e depois entra.')}
  if(m==='recuperar'){r=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin});if(!r.error)return msg('Enviámos um email com o link para mudares a password.')}
  if(m==='nova'){if(password.length<8)return msg('A password precisa de pelo menos 8 caracteres.');r=await sb.auth.updateUser({password});if(!r.error){recovering=false;msg('Password alterada.');$('login').classList.add('hide');$('app').classList.remove('hide');return start()}}
  if(r&&r.error)msg(r.error.message==='Invalid login credentials'?'Email ou password errados.':r.error.message);
});
let started=false,recovering=false;
async function start(){
  const{data:{session}}=await sb.auth.getSession();
  if(!session)return showLogin('entrar');
  if(started)return;started=true;
  me={id:session.user.id,email:session.user.email};
  if(!recovering){$('login').classList.add('hide');$('app').classList.remove('hide')}
  buildNav();
  try{await loadPerfis();await loadDocs();loaded=true;note(games.length?'':'Ainda não há jogos guardados.');openForm(null);refresh()}
  catch(e){note('Erro a ler dados: '+e.message)}
  sb.channel('alteracoes')
    .on('postgres_changes',{event:'*',schema:'public',table:'docs'},p=>{const r=p.new&&p.new.col?p.new:p.old;if(!r||!r.col)return loadDocs();put(r.col,r.id,p.eventType==='DELETE'?null:p.new.data)})
    .on('postgres_changes',{event:'*',schema:'public',table:'perfis'},async()=>{await loadPerfis();refresh()})
    .subscribe();
  addEventListener('focus',()=>{loadDocs().catch(()=>{})});
}
sb.auth.onAuthStateChange((ev)=>{if(ev==='PASSWORD_RECOVERY'){recovering=true;showLogin('nova')}else if(ev==='SIGNED_IN')start()});
if(!SUPABASE_URL||SUPABASE_URL.includes('COLOCA')){$('login').classList.remove('hide');$('lmsg').textContent='Falta configurar o Supabase no ficheiro config.js.'}
else start();
