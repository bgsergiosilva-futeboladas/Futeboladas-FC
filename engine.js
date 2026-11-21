/* Futeboladas FC — regras de pontos, classificação, quotas e equipas (sem dependências) */
const PTS={V:3,E:1,D:0},INV={V:'D',E:'E',D:'V'};
const played=g=>!g.cancelado&&g.r;
function compute(games,roster){
  const names=new Set(roster.map(r=>r.nome));
  const gs=games.filter(played).sort((a,b)=>a.data<b.data?-1:a.data>b.data?1:0);
  const st={};
  for(const r of roster)st[r.nome]={nome:r.nome,ativo:r.ativo!==false,J:0,V:0,E:0,D:0,pj:0,cap:0,capW:0,atr:0,hist:[]};
  let guests=0;
  for(const g of gs){
    for(const [team,res] of [[g.a,g.r],[g.b,INV[g.r]]]){
      team.forEach((n,i)=>{
        if(!names.has(n)){guests++;return}
        const s=st[n];s.J++;s[res]++;s.pj+=PTS[res];s.hist.push(res);
        if(i===0){s.cap++;if(res==='V')s.capW++}
      });
    }
    for(const n of g.atr||[])if(st[n])st[n].atr++;
  }
  const total=gs.length;
  const list=Object.values(st).filter(s=>s.ativo||s.J>0).map(s=>({...s,pts:s.pj+s.capW-s.atr,pv:s.J?s.V/s.J:0,media:s.J?s.pj/s.J:0,comp:total?s.J/total:0,forma:s.hist.slice(-5).reverse()}));
  list.sort((a,b)=>b.pts-a.pts||b.pv-a.pv||b.J-a.J||a.nome.localeCompare(b.nome,'pt'));
  list.forEach((s,i)=>s.pos=i+1);
  return {list,total,guests};
}
function standings(games,roster){
  const cur=compute(games,roster);
  const dates=[...new Set(games.filter(played).map(g=>g.data))].sort();
  if(dates.length>1){
    const prev=compute(games.filter(g=>g.data<dates[dates.length-1]),roster);
    const pp=Object.fromEntries(prev.list.map(s=>[s.nome,s.pos]));
    cur.list.forEach(s=>s.ant=pp[s.nome]??null);
  }
  const L=cur.list.filter(s=>s.J>0),T=cur.total;
  const ext=(arr,f,m)=>{if(!arr.length)return{v:null,n:[]};const v=Math[m](...arr.map(f));return{v,n:arr.filter(s=>f(s)===v).map(s=>s.nome)}};
  cur.stats={maisJogos:ext(L,s=>s.J,'max'),menosJogos:ext(L,s=>s.J,'min'),menosDerr:ext(L,s=>s.D,'min'),maisDerr:ext(L,s=>s.D,'max'),
    maisVit:ext(L,s=>s.V,'max'),maiorPV:ext(L,s=>s.pv,'max'),menorPV:ext(L,s=>s.pv,'min'),maisCap:ext(L,s=>s.cap,'max'),subsJogo:T?cur.guests/T:0};
  cur.prizes={p1:ext(L,s=>s.pts,'max'),p2:ext(L.filter(s=>s.J>=T/2),s=>s.pv,'max'),p3:ext(L,s=>s.J,'max'),minJ:T/2};
  return cur;
}
/* quotas: Nov 2026 = 15€, depois alterna 20€ / 15€ */
const mkAdd=(k,n)=>{let y=+k.slice(0,4),m=+k.slice(5)-1+n;y+=Math.floor(m/12);m=((m%12)+12)%12;return y+'-'+String(m+1).padStart(2,'0')};
const mkDiff=(a,b)=>(+b.slice(0,4)-+a.slice(0,4))*12+(+b.slice(5)-+a.slice(5));
const feeDefault=k=>((mkDiff('2026-11',k)%2)+2)%2===0?15:20;
function charged(r,k){if(r.desde&&k<r.desde)return false;if(r.ativo===false&&r.saida&&k>r.saida)return false;if(r.ativo===false&&!r.saida)return false;return true}
/* histórico de duplas: quantas vezes cada par jogou na mesma equipa (jogos recentes pesam mais) */
function pairHistory(games,roster){
  const names=new Set(roster.map(r=>r.nome)),W={};
  const gs=games.filter(played).sort((a,b)=>a.data<b.data?1:-1);
  gs.forEach((g,age)=>{const w=Math.pow(0.85,age);
    for(const t of [g.a,g.b]){const p=t.filter(n=>names.has(n));
      for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){const k=[p[i],p[j]].sort().join('|');W[k]=(W[k]||0)+w}}});
  return W;
}
/* equipas equilibradas: todas as divisões 7×7; entre as mais equilibradas (até 1 ponto de diferença)
   preferem-se as que repetem menos duplas */
function balance(pl,W){
  W=W||{};const n0=pl.length;const pw=[];
  for(let i=0;i<n0;i++){pw[i]=[];for(let j=0;j<n0;j++)pw[i][j]=i===j?0:(W[[pl[i].nome,pl[j].nome].sort().join('|')]||0)}
  const n=pl.length,h=n/2,T=pl.reduce((s,p)=>s+p.skill,0),Q=pl.reduce((s,p)=>s+p.skill*p.skill,0);
  const out=[];
  for(let m=0;m<(1<<n);m++){
    if(!(m&1))continue;let c=0,s=0,q=0;
    for(let i=0;i<n;i++)if(m>>i&1){c++;s+=pl[i].skill;q+=pl[i].skill*pl[i].skill}
    if(c!==h)continue;
    out.push({m,d:Math.abs(2*s-T),q:Math.abs(2*q-Q)});
  }
  const best=Math.min(...out.map(o=>o.d));
  const cand=out.filter(o=>o.d<=best+1);
  for(const o of cand){let r=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(((o.m>>i)&1)===((o.m>>j)&1))r+=pw[i][j];o.r=r}
  cand.sort((a,b)=>a.r-b.r||a.d-b.d||a.q-b.q);
  return cand.map(o=>({a:pl.filter((p,i)=>o.m>>i&1),b:pl.filter((p,i)=>!(o.m>>i&1)),d:o.d,r:o.r}));
}
export {PTS,INV,played,compute,standings,pairHistory,balance,feeDefault,charged,mkAdd,mkDiff};
