// Futeboladas FC — envio de notificações no telemóvel (Supabase Edge Function "notificar")
//
// É chamada a cada 30 minutos pelo agendamento (pg_cron) e só envia nestas horas de Lisboa:
//   Segunda 08:30· todos              · inscrições abertas para quinta
//   Terça 21h    · quem não respondeu · lembrete
//   Quarta 21h   · quem não respondeu · último aviso (fecha às 23:59)
//   Quinta 18h   · convocados         · equipas publicadas / capitães sorteados
//   Sexta 21h    · quem jogou e ainda não votou · votar no MVP até domingo
//   Dia 1 10h    · quem tem quotas de meses anteriores por pagar · alerta de atraso (+ resumo ao tesoureiro)
//   Dias 1–15 21h· quem não pagou a quota do mês
//   Todos os dias 21h · admin: registos por aprovar · tesoureiro: pagamentos MB WAY por confirmar
//
// Também envia uma notificação de teste a quem a pede na app (botão "Enviar teste").
//
// Segredos (Edge Functions → Secrets): VAPID_PUBLIC, VAPID_PRIVATE, CRON_SECRET
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

/* ------------------------------------------------------------------ datas em Lisboa */
const TZ = "Europe/Lisbon";
export function lisboa(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { data: `${p.year}-${p.month}-${p.day}`, hora: +p.hour % 24, min: +p.minute, dia: +p.day, dow: wd };
}
// instante (ms) de uma hora local de Lisboa
export function lisEpoch(data: string, h: number, mi: number, s: number) {
  const [y, m, d] = data.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) {
    const l = lisboa(new Date(t));
    const [ly, lm, ld] = l.data.split("-").map(Number);
    const local = Date.UTC(ly, lm - 1, ld, l.hora, new Date(t).getUTCMinutes(), new Date(t).getUTCSeconds());
    t += Date.UTC(y, m - 1, d, h, mi, s) - local;
  }
  return t;
}
const addDias = (data: string, n: number) => { const [y, m, d] = data.split("-").map(Number); const o = new Date(Date.UTC(y, m - 1, d + n)); return o.toISOString().slice(0, 10); };
const MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const fdt = (d: string) => +d.slice(8) + " " + MES[+d.slice(5, 7) - 1].slice(0, 3);
const mname = (k: string) => MES[+k.slice(5) - 1];
const euro = (v: number) => (Math.round(v * 100) / 100).toLocaleString("pt-PT") + " €";

/* ------------------------------------------------------------------ regras da app */
const MAXJ = 14, PSTART = "2025-12";
const mkAdd = (k: string, n: number) => { let y = +k.slice(0, 4), m = +k.slice(5) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + "-" + String(m + 1).padStart(2, "0"); };
const mkDiff = (a: string, b: string) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5) - +a.slice(5));
const feeDefault = (k: string) => (((mkDiff("2026-11", k) % 2) + 2) % 2 === 0 ? 15 : 20);
// deno-lint-ignore no-explicit-any
type Any = any;
function charged(r: Any, k: string) { if (r.desde && k < r.desde) return false; if (r.ativo === false && r.saida && k > r.saida) return false; if (r.ativo === false && !r.saida) return false; return true; }

// deno-lint-ignore no-explicit-any
export function presenca(D: Any, data: string) {
  const lim = lisEpoch(addDias(data, -1), 23, 59, 59), opn = lisEpoch(addDias(data, -3), 8, 30, 0);
  const man = ((D.conv[data] || {}).manual) || {};
  const map: Record<string, Any> = {};
  for (const v of Object.values(D.votos) as Any[]) { const x = v.v && v.v[data]; if (x && v.jogador && !(x.t > lim) && !(x.t < opn) && (!map[v.jogador] || x.t > map[v.jogador].t)) map[v.jogador] = x; }
  for (const [n, x] of Object.entries(man) as Any) if (!map[n] || x.t > map[n].t) map[n] = x;
  const act = D.roster.filter((r: Any) => r.ativo !== false).map((r: Any) => r.nome);
  const yes = Object.entries(map).filter(([n, x]: Any) => x.vai && act.includes(n)).sort((a: Any, b: Any) => a[1].t - b[1].t).map((e) => e[0]);
  return { go: yes.slice(0, MAXJ), wait: yes.slice(MAXJ), none: act.filter((n: string) => !map[n]) };
}

// Decide o que enviar agora. Devolve [{chave, para:[user_id], titulo, texto, url}]
// deno-lint-ignore no-explicit-any
export function planear(now: Date, D: Any) {
  const L = lisboa(now), out: Any[] = [];
  const abre = L.dow === 1 && L.hora === 8 && L.min >= 30;
  const mvpAbre = L.dow === 4 && L.hora === 22 && L.min < 30; // quinta 22h: fim do jogo, abre a votação do MVP
  const manha = L.dow === 5 && L.hora >= 8 && L.hora % 2 === 0 && L.min < 30; // sexta: 8h, 10h, 12h … 22h
  const mvpLembra = (L.dow === 5 || L.dow === 6 || L.dow === 0) && [10, 15, 20].includes(L.hora) && L.min < 30; // sex/sáb/dom: 3 lembretes por dia
  const mvpVencedor = L.dow === 1 && L.hora === 9 && L.min < 30; // segunda 09:00: parabéns ao MVP
  const atraso = L.dia === 1 && L.hora === 10 && L.min < 30; // dia 1, 10:00: alerta a quem ficou com quotas de meses anteriores por pagar
  if (!abre && !manha && !mvpAbre && !mvpLembra && !mvpVencedor && !atraso && !((L.hora === 21 || L.hora === 18) && L.min < 30)) return out;
  // contas → jogador e perfis
  const contas = Object.entries(D.acessos as Record<string, Any>).map(([uid, a]) => ({
    uid, jogador: a.jogador || "", papeis: Array.isArray(a.papeis) ? a.papeis : a.papel ? [a.papel] : [],
  })).filter((c) => !c.jogador || D.roster.some((r: Any) => r.nome === c.jogador && r.ativo !== false));
  for (const d of D.donos) if (!contas.some((c) => c.uid === d)) contas.push({ uid: d, jogador: "", papeis: ["admin"] });
  for (const c of contas) if (D.donos.includes(c.uid) && !c.papeis.includes("admin")) c.papeis.push("admin");
  const deJog = (nomes: string[]) => contas.filter((c) => c.jogador && nomes.includes(c.jogador)).map((c) => c.uid);
  const todos = contas.map((c) => c.uid);
  const add = (chave: string, para: string[], titulo: string, texto: string, url = "/") => { if (para.length) out.push({ chave: chave + "@" + L.data, para: [...new Set(para)], titulo, texto, url }); };
  const quinta = addDias(L.data, (4 - L.dow + 7) % 7);
  const houveJogo = (data: string) => D.jogos[`g${data.replace(/-/g, "")}`];
  // quem jogou: as equipas do registo; se ainda só tiver os capitães (sorteio), junta os convocados
  const jogaram = (g: Any) => { const b = [...g.a, ...g.b]; return [...new Set(b.length < 10 ? [...b, ...presenca(D, g.data).go] : b)].filter((n: string) => n !== "Substituto"); };
  const jogoFechado = (data: string) => { const g = houveJogo(data); return g && (g.r || g.cancelado); };
  const apont = contas.filter((c) => c.papeis.includes("admin") || c.papeis.includes("apontador")).map((c) => c.uid);

  // sexta a partir das 08:00, de 2 em 2 horas: lembrar admin e apontadores até alguém registar o resultado de ontem
  if (manha) {
    const ontem = addDias(L.data, -1), g = houveJogo(ontem);
    const pendente = Object.values(D.propostas as Record<string, Any>).some((p) => p.tipo === "jogo" && p.estado === "pendente" && p.alvo === `g${ontem.replace(/-/g, "")}`);
    if (!pendente && ((g && !g.r && !g.cancelado) || (!g && presenca(D, ontem).go.length > 0)))
      add("resultado-" + L.hora, apont, L.hora === 8 ? "Falta o resultado de ontem 📋" : "Ainda falta o resultado de ontem 📋", `Indica quem ganhou o jogo de ${fdt(ontem)} e quem chegou atrasado.`, "/#jogos");
  }

  // quinta 22:00: abre a votação do MVP para quem jogou
  if (mvpAbre) {
    const g = houveJogo(L.data);
    if (g && !g.cancelado) {
      const jogou = jogaram(g);
      add("mvp-abre", deJog(jogou), "Votação do MVP aberta 🏆", "Quem foi o melhor em campo hoje? Vota até domingo às 23:59. O eleito ganha +1 ponto.", "/#classificacao");
    }
  }

  // MVP: lembretes sexta, sábado e domingo (10h, 15h, 20h) a quem jogou e ainda não votou
  if (mvpLembra) {
    const qui = addDias(L.data, -((L.dow + 7 - 4) % 7)), g = houveJogo(qui);
    if (g && !g.cancelado) {
      const gid = `g${qui.replace(/-/g, "")}`;
      const jogou = jogaram(g);
      const votou = new Set(Object.entries(D.mvpvotos as Record<string, Any>).filter(([, v]) => v.v && v.v[gid]).map(([uid]) => uid));
      add("mvp-" + L.hora, deJog(jogou).filter((u) => !votou.has(u)), "Quem foi o MVP? 🏆",
        L.dow === 0 ? "Último dia: vota no MVP do jogo de quinta até hoje às 23:59. O eleito ganha +1 ponto." : `Ainda não votaste no MVP do jogo de quinta (${fdt(qui)}). Vota até domingo às 23:59.`, "/#classificacao");
    }
  }
  // segunda 09:00: avisar o(s) MVP eleito(s) do último jogo
  if (mvpVencedor) {
    const qui = addDias(L.data, -4), g = houveJogo(qui);
    if (g && !g.cancelado) {
      const gid = `g${qui.replace(/-/g, "")}`, fecho = lisEpoch(addDias(qui, 3), 23, 59, 59);
      const nomes = new Set(D.roster.map((r: Any) => r.nome)), cand = jogaram(g).filter((n: string) => nomes.has(n));
      const cont: Record<string, number> = {};
      for (const v of Object.values(D.mvpvotos) as Any[]) { const x = v.v && v.v[gid]; if (!x || !cand.includes(x.nome) || !cand.includes(v.jogador) || x.nome === v.jogador || (x.t && x.t > fecho)) continue; cont[x.nome] = (cont[x.nome] || 0) + 1; }
      const max = Math.max(0, ...Object.values(cont)), venc = max > 0 ? Object.keys(cont).filter((n) => cont[n] === max) : [];
      add("mvp-venc", deJog(venc), "🏆 Foste eleito MVP!", `Parabéns! Foste o MVP do jogo de quinta (${fdt(qui)}) com ${max} voto${max === 1 ? "" : "s"}. Ganhaste +1 ponto na tabela.`, "/#classificacao");
    }
  }

  // segunda 08:30: abrem as inscrições
  if (abre && !jogoFechado(quinta)) add("conv-abre", todos, "Inscrições abertas ⚽", `Vais jogar na quinta, ${fdt(quinta)} às 21h? Responde até quarta às 23:59.`, "/#convocatoria");
  // dia 1, 10:00: começa o mês novo — alerta de falta de pagamento a quem deixou meses anteriores por pagar
  if (atraso) {
    const k = L.data.slice(0, 7), ms: string[] = [];
    for (let m = PSTART; m < k; m = mkAdd(m, 1)) ms.push(m);
    const fee = (m: string) => (D.pags[m] && D.pags[m].valor != null ? D.pags[m].valor : feeDefault(m));
    let totDev = 0; const quem: string[] = [];
    for (const r of D.roster) {
      const st = (m: string) => { const p = D.pags[m] || {}; if (!charged(r, m)) return "fora"; if ((p.isentos || []).includes(r.nome)) return "isento"; return p.pagos && p.pagos[r.nome] ? "pago" : "falta"; };
      const deve = ms.filter((m) => st(m) === "falta");
      if (!deve.length) continue;
      const tot = deve.reduce((s, m) => s + fee(m), 0);
      quem.push(r.nome); totDev += tot;
      const novo = charged(r, k) ? ` A quota de ${mname(k)} (${euro(fee(k))}) já pode ser paga.` : "";
      add("atraso-" + r.nome, deJog([r.nome]), "⚠️ Quota em atraso",
        `Ficou por pagar ${deve.length > 1 ? "as quotas de " + deve.map(mname).join(", ") : "a quota de " + mname(deve[0])}: ${euro(tot)}.${novo} Paga por MB WAY na app.`, "/#pagamentos");
    }
    if (quem.length) {
      const admins = contas.filter((c) => c.papeis.includes("admin")).map((c) => c.uid);
      const tes = contas.filter((c) => c.papeis.includes("tesoureiro")).map((c) => c.uid);
      add("atraso-resumo", tes.length ? tes : admins, "Quotas em atraso", `${quem.length} jogador${quem.length > 1 ? "es têm" : " tem"} quotas de meses anteriores por pagar (${euro(totDev)}): ${quem.join(", ")}.`, "/#pagamentos");
    }
  }
  if (L.hora === 21) {
    if ((L.dow === 2 || L.dow === 3) && !jogoFechado(quinta)) {
      const P = presenca(D, quinta);
      add(L.dow === 2 ? "conv-lembrete" : "conv-ultimo", deJog(P.none),
        L.dow === 2 ? "Ainda não respondeste ⚽" : "Último aviso: convocatória fecha hoje",
        L.dow === 2 ? `Vais ao jogo de quinta, ${fdt(quinta)}? Responde até amanhã às 23:59.` : `Responde até às 23:59 se vais ao jogo de quinta, ${fdt(quinta)}. Vão ${P.go.length} de 14.`, "/#convocatoria");
    }
    // quotas (dias 1 a 15); no dia 1 quem tem meses em atraso já recebeu o alerta das 10h
    if (L.dia <= 15) {
      const k = L.data.slice(0, 7), ms: string[] = [];
      for (let m = PSTART; m <= k; m = mkAdd(m, 1)) ms.push(m);
      const fee = (m: string) => (D.pags[m] && D.pags[m].valor != null ? D.pags[m].valor : feeDefault(m));
      for (const r of D.roster) {
        const st = (m: string) => { const p = D.pags[m] || {}; if (!charged(r, m)) return "fora"; if ((p.isentos || []).includes(r.nome)) return "isento"; return p.pagos && p.pagos[r.nome] ? "pago" : "falta"; };
        if (st(k) !== "falta") continue;
        if (L.dia === 1 && ms.some((m) => m < k && st(m) === "falta")) continue;
        const deve = ms.filter((m) => st(m) === "falta"), tot = deve.reduce((s, m) => s + fee(m), 0);
        add("quota-" + r.nome, deJog([r.nome]), `Quota de ${mname(k)} por pagar`,
          deve.length > 1 ? `Deves ${euro(tot)} (${deve.map(mname).join(", ")}). Podes pagar por MB WAY na app.` : `A quota de ${mname(k)} é ${euro(fee(k))}. Podes pagar por MB WAY na app.`, "/#pagamentos");
      }
    }
    // aprovações
    const pend = Object.values(D.propostas as Record<string, Any>).filter((p) => p.estado === "pendente");
    const nAdm = pend.filter((p) => ["jogo", "equipas", "substituto"].includes(p.tipo)).length;
    const nTes = pend.filter((p) => p.tipo === "pagamento").length;
    const admins = contas.filter((c) => c.papeis.includes("admin")).map((c) => c.uid);
    const tes = contas.filter((c) => c.papeis.includes("tesoureiro")).map((c) => c.uid);
    if (nAdm) add("aprovar", admins, "Registos para aprovar", `Tens ${nAdm} registo${nAdm > 1 ? "s" : ""} à espera de aprovação.`, "/#jogos");
    if (nTes) add("mbway", tes.length ? tes : admins, "Pagamentos MB WAY por confirmar", `${nTes} pagamento${nTes > 1 ? "s" : ""} avisado${nTes > 1 ? "s" : ""} por MB WAY. Confirma se o dinheiro chegou.`, "/#pagamentos");
  }
  if (L.hora === 18 && L.dow === 4) {
    const e = (D.conv[L.data] || {}).equipas;
    if (e) {
      const P = presenca(D, L.data);
      add("equipas", deJog(P.go), "Já viste a convocatória de hoje? ⚽", "Hoje há jogo às 21h no FUT7 Palmeira. Vê na app em que equipa jogas.", "/#convocatoria");
    }
  }
  return out;
}

/* ------------------------------------------------------------------ servidor */
const json = (o: Any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret, apikey, x-client-info" } });

// Envia a cada telemóvel das contas indicadas. Se "det" vier, regista por conta:
//   e = telemóveis que receberam · f = falharam · x = subscrições caducadas (apagadas) · s = telemóveis registados
async function enviar(sb: Any, para: string[], msg: Any, det?: Record<string, Any>) {
  const { data: subs } = await sb.from("push_subs").select("endpoint,sub,user_id").in("user_id", para);
  let ok = 0;
  if (det) for (const u of para) det[u] = { e: 0, f: 0, x: 0, s: 0 };
  for (const s of subs || []) {
    const d = det && det[s.user_id];
    if (d) d.s++;
    try { await webpush.sendNotification(s.sub, JSON.stringify(msg), { TTL: 6 * 3600 }); ok++; if (d) d.e++; }
    catch (e: Any) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { await sb.from("push_subs").delete().eq("endpoint", s.endpoint); if (d) d.x++; }
      else { console.error("push", e && e.statusCode, e && e.body); if (d) d.f++; }
    }
  }
  return ok;
}

async function carregar(sb: Any) {
  const { data: rows } = await sb.from("docs").select("col,id,data");
  const D: Any = { roster: [], acessos: {}, conv: {}, votos: {}, mvpvotos: {}, jogos: {}, pags: {}, propostas: {}, donos: [] };
  for (const r of rows || []) {
    if (r.col === "config" && r.id === "plantel") D.roster = r.data.roster || [];
    else if (r.col === "config" && r.id === "acessos") D.acessos = r.data.map || {};
    else if (r.col === "conv") D.conv[r.id] = r.data;
    else if (r.col === "votos") D.votos[r.id] = r.data;
    else if (r.col === "mvpvotos") D.mvpvotos[r.id] = r.data;
    else if (r.col === "jogos") D.jogos[r.id] = r.data;
    else if (r.col === "pagamentos") D.pags[r.id] = r.data;
    else if (r.col === "propostas") D.propostas[r.id] = r.data;
  }
  return D;
}

// Lista de espera: regista quem está nela e avisa quem entrar nos 14 depois de lá ter estado.
export function esperaPlano(D: Any, data: string, agoraMs: number) {
  if (agoraMs >= lisEpoch(data, 21, 0, 0)) return { registar: [], go: null }; // o jogo já começou
  const P = presenca(D, data);
  return { registar: P.wait as string[], go: P.go as string[] };
}
async function tratarEspera(sb: Any, D: Any, data: string, agoraMs: number) {
  const pl: Any = esperaPlano(D, data, agoraMs);
  if (!pl.go) return [];
  for (const n of pl.registar) await sb.from("notif_log").insert({ chave: `espera|${data}|${n}` });
  const { data: ks } = await sb.from("notif_log").select("chave").like("chave", `espera|${data}|%`);
  const esteve = new Set((ks || []).map((k: Any) => k.chave.split("|").slice(2).join("|")));
  const feito: Any[] = [];
  for (const n of pl.go) {
    if (!esteve.has(n)) continue;
    const { error } = await sb.from("notif_log").insert({ chave: `promo|${data}|${n}` });
    if (error) continue; // já avisado
    const uids = Object.entries(D.acessos as Record<string, Any>).filter(([, a]) => a && a.jogador === n).map(([u]) => u);
    const k = await enviar(sb, uids, { title: "✅ Foste convocado!", body: `Alguém desistiu e entraste nos ${MAXJ} para quinta, ${fdt(data)} às 21h00. Se já não puderes ir, retira a resposta na app.`, url: "/#convocatoria" });
    await sb.from("notif_log").update({ n: k }).eq("chave", `promo|${data}|${n}`);
    feito.push({ promovido: n, enviados: k });
  }
  return feito;
}
const proxQuinta = (hoje: string, dow: number) => addDias(hoje, (4 - dow + 7) % 7);

if (typeof Deno !== "undefined" && Deno.serve) Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  webpush.setVapidDetails("mailto:futeboladas@example.com", Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  // notificação de teste, pedida por quem está com sessão iniciada na app
  if (body.teste) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ erro: "sessão inválida" }, 401);
    const n = await enviar(sb, [u.user.id], { title: "Notificações ativas ✅", body: "A partir de agora recebes aqui os avisos das Futeboladas.", url: "/" });
    return json({ enviados: n });
  }

  // administrador repõe a password de uma conta: gera uma temporária e obriga a mudar no próximo login
  if (body.resetpass) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ erro: "sessão inválida" }, 401);
    const alvo = String(body.resetpass);
    if (!/^[0-9a-f-]{36}$/i.test(alvo)) return json({ erro: "conta inválida" }, 400);
    if (alvo === u.user.id) return json({ erro: "Não podes repor a tua própria password aqui." }, 400);
    const D = await carregar(sb);
    const { data: dn } = await sb.from("donos").select("user_id");
    const donos = (dn || []).map((d: Any) => d.user_id);
    const papeis = (uid: string) => { const a = D.acessos[uid] || {}; return Array.isArray(a.papeis) ? a.papeis : a.papel ? [a.papel] : []; };
    const eDono = donos.includes(u.user.id);
    if (!eDono && !papeis(u.user.id).includes("admin")) return json({ erro: "sem permissão" }, 403);
    // o dono da app nunca pode ser reposto por aqui; outros administradores só pelo dono
    if (donos.includes(alvo)) return json({ erro: "A password do dono da app não pode ser reposta aqui." }, 403);
    if (papeis(alvo).includes("admin") && !eDono) return json({ erro: "Só o dono da app pode repor a password de outro administrador." }, 403);
    if (!D.acessos[alvo]) return json({ erro: "Esta conta não tem acesso à app." }, 400);
    const ALF = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const rnd = crypto.getRandomValues(new Uint32Array(12));
    const chars = Array.from(rnd, (x) => ALF[x % ALF.length]).join("");
    const pass = `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
    const { data: alvoU, error: e1 } = await sb.auth.admin.getUserById(alvo);
    if (e1 || !alvoU || !alvoU.user) return json({ erro: "conta não encontrada" }, 404);
    const { error } = await sb.auth.admin.updateUserById(alvo, { password: pass, app_metadata: { ...(alvoU.user.app_metadata || {}), mudar_pass: true } });
    if (error) return json({ erro: "Não foi possível repor a password." }, 500);
    console.log("resetpass", { por: u.user.id, alvo });
    return json({ pass, email: alvoU.user.email || "" });
  }

  // o próprio utilizador escolhe a password nova depois de uma reposição pelo administrador
  if (body.novapass) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ erro: "sessão inválida" }, 401);
    const { data: cur } = await sb.auth.admin.getUserById(u.user.id);
    const md = (cur && cur.user && cur.user.app_metadata) || {};
    if (!md.mudar_pass) return json({ erro: "Não há nenhuma mudança de password pendente." }, 400);
    const p = String(body.novapass);
    if (p.length < 8 || p.length > 72) return json({ erro: "A password tem de ter entre 8 e 72 caracteres." }, 400);
    const { error } = await sb.auth.admin.updateUserById(u.user.id, { password: p, app_metadata: { ...md, mudar_pass: false } });
    if (error) return json({ erro: "Não foi possível guardar a password." }, 500);
    return json({ ok: true });
  }

  // admin/apontador gravou o resultado: avisar os outros
  if (body.resultado) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ erro: "sessão inválida" }, 401);
    const gid = String(body.resultado);
    if (!/^g\d{8}$/.test(gid)) return json({ erro: "jogo inválido" }, 400);
    const D = await carregar(sb);
    const { data: dn } = await sb.from("donos").select("user_id");
    const donos = (dn || []).map((d: Any) => d.user_id);
    const papeis = (uid: string) => { const a = D.acessos[uid] || {}; const p = Array.isArray(a.papeis) ? [...a.papeis] : a.papel ? [a.papel] : []; if (donos.includes(uid)) p.push("admin"); return p; };
    const eApont = (uid: string) => papeis(uid).some((p: string) => p === "admin" || p === "apontador");
    if (!eApont(u.user.id)) return json({ erro: "sem permissão" }, 403);
    const oficial = D.jogos[gid] && D.jogos[gid].r ? D.jogos[gid] : null;
    const g = oficial || (Object.values(D.propostas) as Any[]).filter((p) => p.tipo === "jogo" && p.alvo === gid && p.por === u.user.id && p.doc && p.doc.r).map((p) => p.doc)[0];
    if (!g) return json({ erro: "sem resultado" }, 400);
    const ontem = addDias(lisboa(new Date()).data, -1) === g.data;
    const venc = g.r === "V" ? "a" : g.r === "D" ? "b" : null;
    const nomeEq = (k: string) => g.coletes ? (k === g.coletes ? "Equipa Coletes" : "Equipa S/ Coletes") : `Equipa ${k === "a" ? 1 : 2}`;
    const res = venc ? `Ganhou a ${nomeEq(venc)}.` : "Empate.";
    const out: Any = {};
    // 1) aos outros admins/apontadores: quem apontou (uma vez por jogo)
    if (!(await sb.from("notif_log").insert({ chave: `resultado|${gid}` })).error) {
      const { data: pf } = await sb.from("perfis").select("nome").eq("user_id", u.user.id).maybeSingle();
      const quem = (D.acessos[u.user.id] || {}).jogador || (pf && pf.nome) || "um apontador";
      const para = [...new Set([...Object.keys(D.acessos), ...donos])].filter((uid) => uid !== u.user.id && eApont(uid));
      out.apontado = await enviar(sb, para, { title: "📋 Resultado registado", body: `O resultado do jogo ${ontem ? "de ontem" : "de " + fdt(g.data)} foi apontado por: ${quem}. ${res}`, url: "/#jogos" });
      await sb.from("notif_log").update({ n: out.apontado }).eq("chave", `resultado|${gid}`);
    }
    // 2) a todos, quando o resultado é oficial (gravado pelo admin ou aprovado): a equipa que venceu
    if (oficial && !(await sb.from("notif_log").insert({ chave: `resultado-todos|${gid}` })).error) {
      const corpo = venc ? `🏆 Ganhou a ${nomeEq(venc)}.` : `🤝 O jogo ${ontem ? "de ontem" : "de " + fdt(g.data)} acabou empatado.`;
      const todos = [...new Set([...Object.keys(D.acessos), ...donos])];
      out.todos = await enviar(sb, todos, { title: "Resultado do último jogo disponível", body: corpo, url: "/#jogos" });
      await sb.from("notif_log").update({ n: out.todos }).eq("chave", `resultado-todos|${gid}`);
    }
    return json(out);
  }

  // equipas publicadas na convocatória: avisar logo os convocados
  if (body.equipas) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ erro: "sessão inválida" }, 401);
    const data = String(body.equipas);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return json({ erro: "data inválida" }, 400);
    const D = await carregar(sb);
    const { data: dn } = await sb.from("donos").select("user_id");
    const donos = (dn || []).map((d: Any) => d.user_id);
    const a = D.acessos[u.user.id] || {}, pp = Array.isArray(a.papeis) ? a.papeis : a.papel ? [a.papel] : [];
    if (!donos.includes(u.user.id) && !pp.includes("admin") && !pp.includes("apontador")) return json({ erro: "sem permissão" }, 403);
    const e = (D.conv[data] || {}).equipas;
    if (!e) return json({ erro: "sem equipas" }, 400);
    // uma vez por cada versão das equipas (se forem republicadas diferentes, avisa que mudaram)
    const assin = JSON.stringify([e.a, e.b, e.capA, e.capB, e.coletes]);
    let h = 0; for (let i = 0; i < assin.length; i++) h = (h * 31 + assin.charCodeAt(i)) | 0;
    const { data: ant } = await sb.from("notif_log").select("chave").like("chave", `equipas-pub|${data}|%`);
    const forcar = !!body.forcar; // botão "Avisar convocados": envia sempre, sem mexer nas equipas
    const chave = forcar ? `equipas-man|${data}|${Date.now()}` : `equipas-pub|${data}|${h}`;
    if ((await sb.from("notif_log").insert({ chave })).error) return json({ feito: [] });
    const P = presenca(D, data);
    const para = Object.entries(D.acessos as Record<string, Any>).filter(([, x]) => x && x.jogador && P.go.includes(x.jogador)).map(([uid]) => uid);
    const dia = data === lisboa(new Date()).data ? "de hoje" : `de quinta, ${fdt(data)}`;
    const corpo = e.modo === "capitaes"
      ? `Capitães sorteados: ${e.capA} e ${e.capB}. Eles escolhem as equipas no campo.`
      : `Já temos o 7 inicial de cada equipa! Vê em que equipa jogas e quem leva coletes.`;
    const det: Record<string, Any> = {};
    const n = await enviar(sb, para, { title: (!forcar && ant && ant.length ? "Equipas atualizadas para o jogo " : "Equipas para o jogo ") + dia + " ⚽", body: corpo, url: "/#convocatoria" }, det);
    await sb.from("notif_log").update({ n, det }).eq("chave", chave);
    return json({ enviados: n, det });
  }

  // o tesoureiro confirmou (ou não) um "Já paguei": avisar quem pagou
  if (body.pagamento) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ erro: "sessão inválida" }, 401);
    const D = await carregar(sb);
    const { data: dn } = await sb.from("donos").select("user_id");
    const donos = (dn || []).map((d: Any) => d.user_id);
    const a = D.acessos[u.user.id] || {}, pp = Array.isArray(a.papeis) ? a.papeis : a.papel ? [a.papel] : [];
    if (!donos.includes(u.user.id) && !pp.includes("tesoureiro") && !pp.includes("admin")) return json({ erro: "sem permissão" }, 403);
    const id = String(body.pagamento), p = D.propostas[id];
    if (!p || p.tipo !== "pagamento" || !p.por) return json({ erro: "aviso inválido" }, 400);
    const ok = !!body.ok, chave = `pag|${id}|${ok ? "ok" : "nao"}`;
    if ((await sb.from("notif_log").insert({ chave })).error) return json({ feito: [] });
    const meses = ((p.doc && p.doc.meses) || []).map(mname).join(", "), valor = euro(+((p.doc && p.doc.valor) || 0));
    const msg = ok
      ? { title: "✅ Pagamento confirmado", body: `O tesoureiro confirmou o teu pagamento de ${valor}${meses ? " (" + meses + ")" : ""}. Obrigado!`, url: "/#pagamentos" }
      : { title: "⚠️ Pagamento não validado", body: `O tesoureiro não encontrou o teu pagamento de ${valor}${meses ? " (" + meses + ")" : ""}${p.nota ? ": " + p.nota : ""}. Confirma no MB WAY e volta a avisar.`, url: "/#pagamentos" };
    const n = await enviar(sb, [p.por], msg);
    await sb.from("notif_log").update({ n }).eq("chave", chave);
    return json({ enviados: n });
  }

  // um jogador mudou de "Vou" para "Não vou": avisar o admin e os apontadores
  if (body.desistencia) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ erro: "sessão inválida" }, 401);
    const D = await carregar(sb);
    const p = D.propostas[String(body.desistencia)];
    if (!p || p.tipo !== "desistencia" || p.por !== u.user.id) return json({ erro: "aviso inválido" }, 400);
    if ((await sb.from("notif_log").insert({ chave: `desist|${body.desistencia}` })).error) return json({ feito: [] });
    const { data: dn } = await sb.from("donos").select("user_id");
    const donos = (dn || []).map((d: Any) => d.user_id);
    const papeis = (uid: string) => { const a = D.acessos[uid] || {}; const q = Array.isArray(a.papeis) ? [...a.papeis] : a.papel ? [a.papel] : []; if (donos.includes(uid)) q.push("admin"); return q; };
    const para = [...new Set([...Object.keys(D.acessos), ...donos])].filter((uid) => uid !== u.user.id && papeis(uid).some((x: string) => x === "admin" || x === "apontador"));
    const P = presenca(D, p.alvo);
    const n = await enviar(sb, para, { title: "↩️ Desistência", body: `${p.doc.nome} mudou para “Não vou” no jogo de quinta, ${fdt(p.alvo)}. Vão ${P.go.length} de ${MAXJ}.`, url: "/#convocatoria" });
    await sb.from("notif_log").update({ n }).eq("chave", `desist|${body.desistencia}`);
    return json({ enviados: n });
  }

  // alguém mudou a resposta na convocatória: tratar a lista de espera desse jogo
  if (body.espera) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ erro: "sessão inválida" }, 401);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.espera))) return json({ erro: "data inválida" }, 400);
    const D = await carregar(sb);
    if (!D.acessos[u.user.id]) return json({ erro: "sem acesso" }, 403);
    return json({ feito: await tratarEspera(sb, D, body.espera, Date.now()) });
  }

  // chamada do agendamento
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ erro: "proibido" }, 403);
  const D = await carregar(sb);
  const { data: donos } = await sb.from("donos").select("user_id");
  D.donos = (donos || []).map((d: Any) => d.user_id);

  const plano = planear(body.agora ? new Date(body.agora) : new Date(), D), feito: Any[] = [];
  for (const p of plano) {
    const { error } = await sb.from("notif_log").insert({ chave: p.chave });
    if (error) continue; // já enviado
    const det: Record<string, Any> = {};
    const n = await enviar(sb, p.para, { title: p.titulo, body: p.texto, url: p.url }, det);
    await sb.from("notif_log").update({ n, det }).eq("chave", p.chave);
    feito.push({ chave: p.chave, pessoas: p.para.length, enviados: n });
  }
  const agora = body.agora ? new Date(body.agora) : new Date(), Lh = lisboa(agora);
  feito.push(...await tratarEspera(sb, D, proxQuinta(Lh.data, Lh.dow), agora.getTime()));
  return json({ hora: lisboa(new Date()), feito });
});
