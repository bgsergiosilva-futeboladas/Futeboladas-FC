// Futeboladas FC — ligação ao Supabase: contas (entrar, convite, recuperar password)
// e uma camada de dados com o mesmo formato que a app usa (doc/collection/onSnapshot).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC } from './config.js';

const $ = id => document.getElementById(id);
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
window.SB = sb;

/* ------------------------------------------------------------------ ecrãs de conta */
const ERR = {
  'Invalid login credentials': 'Email ou password errados.',
  'Email not confirmed': 'Ainda não confirmaste o email. Abre a mensagem que recebeste e toca no link.',
  'User already registered': 'Já existe uma conta com esse email. Usa "Entrar".',
  'Password should be at least 6 characters.': 'A password tem de ter pelo menos 8 caracteres.',
  'For security purposes, you can only request this after': 'Espera um minuto antes de pedir outra vez.',
  'Email rate limit exceeded': 'Foram enviados demasiados emails. Tenta daqui a uma hora.'
};
const msgOf = e => { const m = (e && (e.message || e.error_description)) || String(e || ''); for (const k in ERR) if (m.startsWith(k)) return ERR[k]; return m || 'Ocorreu um erro. Tenta outra vez.'; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FOOT = '<p class="au-foot">Futeboladas APP™ versão 1.0 · Feito por Sérgio Silva · © 2026</p>';

function show(html) { $('auth').classList.remove('hide'); $('au-sheet').innerHTML = html + FOOT; document.body.classList.add('au-on'); const f = $('au-sheet').querySelector('input'); if (f && matchMedia('(min-width:700px)').matches) f.focus(); }
function hideAuth() { $('auth').classList.add('hide'); document.body.classList.remove('au-on'); }
const busy = (b, on, txt) => { b.disabled = on; if (txt) b.textContent = txt; };
const out = t => { const e = $('au-err'); if (e) { e.textContent = t || ''; e.classList.toggle('ok', false); } };
const okMsg = t => { const e = $('au-err'); if (e) { e.textContent = t; e.classList.add('ok'); } };

function loginScreen(info) {
  show(`<h2>Entrar</h2>
  <form id="au-f" novalidate>
    <label for="au-e">Email</label><input id="au-e" type="email" autocomplete="username" inputmode="email" placeholder="o-teu@email.pt" required>
    <label for="au-p">Password</label><input id="au-p" type="password" autocomplete="current-password" placeholder="••••••••" required>
    <button type="button" class="au-link" id="au-forgot">Esqueci-me da password</button>
    <p class="au-err" id="au-err" role="alert"></p>
    <button class="au-btn" id="au-go">Entrar</button>
  </form>
  <p class="au-note">Sem conta? Pede o link de convite ao administrador.</p>`);
  if (info) okMsg(info);
  $('au-forgot').onclick = () => forgotScreen($('au-e').value);
  $('au-f').onsubmit = async e => {
    e.preventDefault(); const b = $('au-go'); out('');
    const email = $('au-e').value.trim(), password = $('au-p').value;
    if (!email || !password) return out('Escreve o email e a password.');
    busy(b, true, 'A entrar…');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    busy(b, false, 'Entrar');
    if (error) out(msgOf(error));
  };
}

function forgotScreen(email) {
  show(`<h2>Recuperar password</h2>
  <form id="au-f" novalidate>
    <p class="au-txt">Escreve o email da tua conta. Vais receber um link para definir uma password nova.</p>
    <label for="au-e">Email</label><input id="au-e" type="email" autocomplete="username" inputmode="email" value="${esc(email || '')}" required>
    <p class="au-err" id="au-err" role="alert"></p>
    <button class="au-btn" id="au-go">Enviar link</button>
    <button type="button" class="au-link c" id="au-back">Voltar a entrar</button>
  </form>`);
  $('au-back').onclick = () => loginScreen();
  $('au-f').onsubmit = async e => {
    e.preventDefault(); const em = $('au-e').value.trim(); if (!em) return out('Escreve o email.');
    const b = $('au-go'); busy(b, true, 'A enviar…');
    const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
    busy(b, false, 'Enviar link');
    if (error) return out(msgOf(error));
    okMsg('Se o email tiver conta, recebes o link dentro de minutos. Vê também o spam.');
  };
}

function newPasswordScreen() {
  show(`<h2>Nova password</h2>
  <form id="au-f" novalidate>
    <label for="au-p">Password nova</label><input id="au-p" type="password" autocomplete="new-password" minlength="8" required>
    <label for="au-p2">Repete a password</label><input id="au-p2" type="password" autocomplete="new-password" minlength="8" required>
    <p class="au-err" id="au-err" role="alert"></p>
    <button class="au-btn" id="au-go">Guardar password</button>
  </form>`);
  $('au-f').onsubmit = async e => {
    e.preventDefault(); const p = $('au-p').value;
    if (p.length < 8) return out('A password tem de ter pelo menos 8 caracteres.');
    if (p !== $('au-p2').value) return out('As passwords não são iguais.');
    const b = $('au-go'); busy(b, true, 'A guardar…');
    const { error } = await sb.auth.updateUser({ password: p });
    busy(b, false, 'Guardar password');
    if (error) return out(msgOf(error));
    location.replace(location.pathname);
  };
}

async function inviteScreen(code) {
  show('<h2>Convite</h2><p class="au-txt">A verificar o link…</p>');
  const { data, error } = await sb.rpc('info_convite', { c: code });
  if (error || !data || !data.ok) {
    show(`<h2>Link inválido</h2><p class="au-txt">Este link de convite já não está ativo. Pede um link novo ao administrador.</p><button class="au-btn" id="au-back">Ir para Entrar</button>`);
    $('au-back').onclick = () => { history.replaceState(null, '', location.pathname); loginScreen(); };
    return;
  }
  const opts = (data.jogadores || []).map(n => `<option>${esc(n)}</option>`).join('');
  show(`<h2>Criar conta</h2>
  <form id="au-f" novalidate>
    <label for="au-n">O teu nome</label><input id="au-n" type="text" autocomplete="name" required>
    <label for="au-j">Quem és na lista de jogadores?</label><select id="au-j" required><option value="">— escolher —</option>${opts}</select>
    <label for="au-e">Email</label><input id="au-e" type="email" autocomplete="username" inputmode="email" required>
    <label for="au-p">Password (mínimo 8 caracteres)</label><input id="au-p" type="password" autocomplete="new-password" minlength="8" required>
    <p class="au-err" id="au-err" role="alert"></p>
    <button class="au-btn" id="au-go">Criar conta</button>
    <p class="au-note">A conta fica à espera da aprovação do administrador.</p>
    <button type="button" class="au-link c" id="au-back">Já tenho conta</button>
  </form>`);
  $('au-back').onclick = () => { history.replaceState(null, '', location.pathname); loginScreen(); };
  $('au-f').onsubmit = async e => {
    e.preventDefault(); out('');
    const nome = $('au-n').value.trim(), jogador = $('au-j').value, email = $('au-e').value.trim(), password = $('au-p').value;
    if (!nome || !jogador || !email) return out('Preenche o nome, o jogador e o email.');
    if (password.length < 8) return out('A password tem de ter pelo menos 8 caracteres.');
    const b = $('au-go'); busy(b, true, 'A criar…');
    const { data: r, error: er } = await sb.auth.signUp({ email, password,
      options: { data: { convite: code, jogador, nome }, emailRedirectTo: location.origin + location.pathname } });
    busy(b, false, 'Criar conta');
    if (er) return out(msgOf(er));
    history.replaceState(null, '', location.pathname);
    if (r && r.session) return; // confirmação de email desligada: entra logo
    show(`<h2>Confirma o email</h2><p class="au-txt">Enviámos um email para <b>${esc(email)}</b>. Abre-o e toca no link de confirmação; depois entra com o email e a password.</p><p class="au-txt">Não chegou? Vê a pasta de spam.</p><button class="au-btn" id="au-back">Ir para Entrar</button>`);
    $('au-back').onclick = () => loginScreen();
  };
}

function blockedScreen() {
  show(`<h2>Sem acesso</h2><p class="au-txt">Esta conta não tem acesso à app. Se saíste do grupo, o acesso foi cancelado; se és novo, pede o link de convite ao administrador.</p><button class="au-btn" id="au-out">Terminar sessão</button>`);
  $('au-out').onclick = async () => { await sb.auth.signOut(); loginScreen(); };
}

/* ------------------------------------------------------------------ camada de dados */
const cache = new Map();             // "col/id" -> data
const colL = new Map(), docL = new Map();
let pendingCols = new Set(), pendingDocs = new Set(), flushQ = false;
const key = (c, i) => c + '/' + i;
function colSnap(c) {
  const docs = [];
  for (const [k, v] of cache) { const i = k.indexOf('/'); if (k.slice(0, i) === c) { const id = k.slice(i + 1); docs.push({ id, data: () => v }); } }
  return { docs };
}
const docSnap = p => { const v = cache.get(p); return { exists: v !== undefined, data: () => v }; };
function touch(c, i) {
  pendingCols.add(c); pendingDocs.add(key(c, i));
  if (!flushQ) { flushQ = true; setTimeout(flush, 0); }
}
function flush() {
  flushQ = false; const cs = pendingCols, ds = pendingDocs; pendingCols = new Set(); pendingDocs = new Set();
  for (const c of cs) for (const f of colL.get(c) || []) try { f(colSnap(c)); } catch (e) { console.error(e); }
  for (const p of ds) for (const f of docL.get(p) || []) try { f(docSnap(p)); } catch (e) { console.error(e); }
}
function split(path) { const i = path.indexOf('/'); return [path.slice(0, i), path.slice(i + 1)]; }
const denied = e => { const x = new Error(e && e.message || 'Sem permissão'); x.code = e && e.code === '42501' ? 'sem permissão' : (e && e.code) || 'sem permissão'; return x; };

const db = {
  doc(path) {
    const [c, i] = split(path);
    return {
      async set(data) {
        const { error } = await sb.from('docs').upsert({ col: c, id: i, data }, { onConflict: 'col,id' });
        if (error) throw denied(error);
        cache.set(key(c, i), data); touch(c, i);
      },
      async delete() {
        const { data, error } = await sb.from('docs').delete().eq('col', c).eq('id', i).select('id');
        if (error) throw denied(error);
        if (!data || !data.length) { if (cache.has(key(c, i))) throw denied(); return; }
        cache.delete(key(c, i)); touch(c, i);
      },
      onSnapshot(cb) {
        const p = key(c, i); if (!docL.has(p)) docL.set(p, new Set()); docL.get(p).add(cb);
        setTimeout(() => cb(docSnap(p)), 0);
        return () => docL.get(p).delete(cb);
      }
    };
  },
  collection(c) {
    return {
      onSnapshot(cb) {
        if (!colL.has(c)) colL.set(c, new Set()); colL.get(c).add(cb);
        setTimeout(() => cb(colSnap(c)), 0);
        return () => colL.get(c).delete(cb);
      }
    };
  }
};

async function loadAll() {
  cache.clear();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('docs').select('col,id,data').order('col').order('id').range(from, from + 999);
    if (error) throw error;
    for (const r of data) cache.set(key(r.col, r.id), r.data);
    if (data.length < 1000) break;
  }
}
let channel = null;
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('docs-' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
      if (p.eventType === 'DELETE') { const o = p.old || {}; if (o.col) { cache.delete(key(o.col, o.id)); touch(o.col, o.id); } }
      else { const n = p.new; cache.set(key(n.col, n.id), n.data); touch(n.col, n.id); }
    })
    .subscribe(st => { if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setTimeout(resync, 5000); });
}
// volta a ler tudo (depois de o telemóvel acordar ou de perder ligação)
async function resync() {
  try {
    const before = new Set(cache.keys()); await loadAll();
    for (const k of new Set([...before, ...cache.keys()])) { const [c, i] = split(k); touch(c, i); }
    subscribe();
  } catch (e) { console.warn(e); }
}

/* ------------------------------------------------------------------ arranque */
let user = null, started = false, owner = false;
async function access() {
  const uid = user.id;
  const [{ data: d }, { data: a }, { data: p }] = await Promise.all([
    sb.from('donos').select('user_id').eq('user_id', uid).maybeSingle(),
    sb.from('docs').select('data').eq('col', 'config').eq('id', 'acessos').maybeSingle(),
    sb.from('docs').select('id').eq('col', 'pedidos').eq('id', uid).maybeSingle()
  ]);
  owner = !!d;
  const member = owner || !!(a && a.data && a.data.map && a.data.map[uid]);
  return { member, pending: !!p };
}
const U = {
  async profiles(ids) {
    const out = {}; if (!ids.length) return out;
    const { data } = await sb.from('perfis').select('user_id,nome,email').in('user_id', ids);
    for (const r of data || []) out[r.user_id] = { name: r.nome ? r.nome + (r.email ? ' · ' + r.email : '') : r.email };
    return out;
  }
};
const resolveReady = window.__fbReady;
window.FB = { sair: async () => { await sb.auth.signOut(); location.replace(location.pathname); }, email: () => user && user.email, vapid: VAPID_PUBLIC };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(e => console.warn('sw', e));

async function enter(session) {
  user = session.user;
  let acc;
  try { acc = await access(); } catch (e) { return show(`<h2>Sem ligação</h2><p class="au-txt">Não foi possível contactar o servidor. Verifica a internet e volta a abrir a app.</p>`); }
  if (!acc.member && !acc.pending) return blockedScreen();
  hideAuth();
  if (started) return;
  started = true;
  await loadAll(); subscribe();
  resolveReady({ db, U, me: { id: user.id, owner } });
  // o administrador pode retirar o acesso a qualquer momento (ex.: jogador "Saiu")
  const recheck = async () => { try { const a = await access(); if (!a.member && !a.pending) { await sb.auth.signOut(); location.replace(location.pathname + '?saiu=1'); } } catch (e) {} };
  setInterval(recheck, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { recheck(); resync(); } });
}

(async () => {
  const q = new URLSearchParams(location.search), code = q.get('convite');
  let recovering = /type=recovery/.test(location.hash);
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'PASSWORD_RECOVERY') { recovering = true; return newPasswordScreen(); }
    if (ev === 'SIGNED_IN' && session && !recovering && !started) enter(session);
    if (ev === 'SIGNED_OUT' && started) location.replace(location.pathname);
  });
  const { data: { session } } = await sb.auth.getSession();
  if (recovering) return newPasswordScreen();
  if (code && !session) return inviteScreen(code);
  if (session) return enter(session);
  loginScreen(q.get('saiu') ? 'O teu acesso à app foi cancelado pelo administrador.' : '');
})();
