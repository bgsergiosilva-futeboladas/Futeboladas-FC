-- =====================================================================
--  Futeboladas FC — base de dados (Supabase / PostgreSQL)   versão 1.0
--  Supabase → SQL Editor → New query → colar TUDO → Run.
--  Pode ser corrido mais do que uma vez: não apaga dados.
-- =====================================================================

-- ---------- Tabelas ----------
-- Dados da app: documentos JSON agrupados por coleção
--   config/plantel  config/acessos  config/campo  config/caixa  config/convites
--   jogos/gAAAAMMDD  conv/AAAA-MM-DD  votos/<conta>  mvpvotos/<conta>
--   pagamentos/AAAA-MM  propostas/<id>  pedidos/<conta>  fotos/<conta ou j-nome>
create table if not exists public.docs (
  col        text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);

-- Uma linha por conta (nome e email, para o administrador saber quem é quem)
create table if not exists public.perfis (
  user_id uuid primary key references auth.users on delete cascade,
  email   text,
  criado  timestamptz not null default now()
);
alter table public.perfis add column if not exists nome text;

-- Dono(s) da app: administrador que nunca pode ser removido
create table if not exists public.donos (
  user_id uuid primary key references auth.users on delete cascade
);

-- ---------- Funções de permissão ----------
create or replace function public.e_dono() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from donos where user_id = auth.uid())
$$;

create or replace function public.meu_acesso() returns jsonb
language sql stable security definer set search_path = public as $$
  select data->'map'->(auth.uid()::text) from docs where col = 'config' and id = 'acessos'
$$;

create or replace function public.tem_papel(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.e_dono() or coalesce((
    select coalesce(a->'papeis' ? p, false) or a->>'papel' = p
    from (select public.meu_acesso() as a) x where a is not null), false)
$$;

-- Tem acesso aprovado (o administrador retira-o ao marcar "Saiu" ou "Remover")
create or replace function public.membro() returns boolean
language sql stable security definer set search_path = public as $$
  select public.e_dono() or public.meu_acesso() is not null
$$;

-- Inscreveu-se por convite e espera aprovação
create or replace function public.pendente() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from docs where col = 'pedidos' and id = auth.uid()::text)
$$;

-- ---------- Convites ----------
create or replace function public.convite_valido(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from docs d, jsonb_array_elements(coalesce(d.data->'lista','[]'::jsonb)) e
    where d.col = 'config' and d.id = 'convites'
      and e->>'code' = c and coalesce((e->>'ativo')::boolean, false))
$$;

-- Página de convite (antes de haver conta): diz se o link é válido e
-- lista os jogadores ativos que ainda não têm conta associada.
create or replace function public.info_convite(c text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ok boolean := public.convite_valido(c); nomes jsonb;
begin
  if not ok then return jsonb_build_object('ok', false); end if;
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) into nomes from (
    select r->>'nome' as n
    from docs d, jsonb_array_elements(coalesce(d.data->'roster','[]'::jsonb)) r
    where d.col = 'config' and d.id = 'plantel'
      and coalesce((r->>'ativo')::boolean, true)
      and r->>'nome' not in (
        select coalesce(v->>'jogador','') from docs a, jsonb_each(coalesce(a.data->'map','{}'::jsonb)) m(k, v)
        where a.col = 'config' and a.id = 'acessos')
  ) s;
  return jsonb_build_object('ok', true, 'jogadores', nomes);
end $$;
grant execute on function public.info_convite(text) to anon, authenticated;

-- Quando alguém cria conta: guarda nome/email e, se veio de um convite
-- válido, cria o pedido de acesso para o administrador aprovar.
create or replace function public.novo_utilizador() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c text := new.raw_user_meta_data->>'convite';
  j text := new.raw_user_meta_data->>'jogador';
  n text := new.raw_user_meta_data->>'nome';
begin
  insert into perfis (user_id, email, nome) values (new.id, new.email, n)
    on conflict (user_id) do update set email = excluded.email, nome = coalesce(excluded.nome, perfis.nome);
  if c is not null and public.convite_valido(c) then
    insert into docs (col, id, data) values ('pedidos', new.id::text,
      jsonb_build_object('jogador', j, 'nome', n, 'convite', c,
                         't', (extract(epoch from now()) * 1000)::bigint))
      on conflict (col, id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists ao_criar_utilizador on auth.users;
create trigger ao_criar_utilizador after insert on auth.users
  for each row execute function public.novo_utilizador();

-- updated_at automático
create or replace function public.tocar() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists docs_tocar on public.docs;
create trigger docs_tocar before update on public.docs for each row execute function public.tocar();

-- ---------- Regras de acesso (Row Level Security) ----------
alter table public.docs   enable row level security;
alter table public.perfis enable row level security;
alter table public.donos  enable row level security;

-- limpar regras da versão anterior
drop policy if exists "ler dados" on public.docs;
drop policy if exists "admin escreve tudo" on public.docs;
drop policy if exists "tesoureiro escreve quotas" on public.docs;
drop policy if exists "cada um vota por si" on public.docs;
drop policy if exists "perfil próprio ou admin" on public.perfis;
drop policy if exists "admin altera perfis" on public.perfis;
drop policy if exists "admin apaga perfis" on public.perfis;

-- Ler: quem tem acesso aprovado ou está à espera de aprovação
-- (a skill dos jogadores, em config/skills, fica de fora: só o administrador a lê)
drop policy if exists "ler" on public.docs;
create policy "ler" on public.docs for select to authenticated
  using ((public.membro() or public.pendente()) and not (col = 'config' and id = 'skills'));
drop policy if exists "ler skills" on public.docs;
create policy "ler skills" on public.docs for select to authenticated
  using (col = 'config' and id = 'skills' and public.tem_papel('admin'));

-- Administrador: tudo
drop policy if exists "admin" on public.docs;
create policy "admin" on public.docs for all to authenticated
  using (public.tem_papel('admin')) with check (public.tem_papel('admin'));

-- Tesoureiro: quotas, caixa e avisos de pagamento MB WAY
drop policy if exists "tesoureiro" on public.docs;
create policy "tesoureiro" on public.docs for all to authenticated
  using (public.tem_papel('tesoureiro') and (col = 'pagamentos' or (col = 'config' and id = 'caixa')
         or (col = 'propostas' and data->>'tipo' = 'pagamento')))
  with check (public.tem_papel('tesoureiro') and (col = 'pagamentos' or (col = 'config' and id = 'caixa')
         or (col = 'propostas' and data->>'tipo' = 'pagamento')));

-- Cada um: o seu voto na convocatória, o seu voto MVP e a sua foto
drop policy if exists "proprios" on public.docs;
create policy "proprios" on public.docs for all to authenticated
  using (public.membro() and col in ('votos','mvpvotos','fotos') and id = auth.uid()::text)
  with check (public.membro() and col in ('votos','mvpvotos','fotos') and id = auth.uid()::text
              and data->>'jogador' = public.meu_acesso()->>'jogador');

-- Propostas (registos do apontador, substitutos, avisos "Já paguei", bloqueios de edição):
-- cada um só cria/altera/apaga as suas; os bloqueios de edição são partilhados.
drop policy if exists "propostas" on public.docs;
create policy "propostas" on public.docs for all to authenticated
  using (public.membro() and col = 'propostas'
         and (data->>'por' = auth.uid()::text or data->>'tipo' = 'lock'))
  with check (public.membro() and col = 'propostas'
         and (data->>'por' = auth.uid()::text)
         and (data->>'tipo' <> 'jogo' and data->>'tipo' <> 'equipas' or public.tem_papel('apontador')));

-- Pedido de acesso da própria conta
drop policy if exists "pedido" on public.docs;
create policy "pedido" on public.docs for all to authenticated
  using (col = 'pedidos' and id = auth.uid()::text)
  with check (col = 'pedidos' and id = auth.uid()::text);

-- Perfis: o próprio vê o seu; o administrador vê todos
drop policy if exists "ver perfis" on public.perfis;
create policy "ver perfis" on public.perfis for select to authenticated
  using (user_id = auth.uid() or public.tem_papel('admin'));
drop policy if exists "donos" on public.donos;
create policy "donos" on public.donos for select to authenticated using (user_id = auth.uid());

-- ---------- Skills fora do plantel (os jogadores não as conseguem ler) ----------
insert into public.docs (col, id, data)
select 'config', 'skills', jsonb_build_object(
  'jog', coalesce((select jsonb_object_agg(r->>'nome', r->'skill')
                   from public.docs d, jsonb_array_elements(coalesce(d.data->'roster','[]'::jsonb)) r
                   where d.col = 'config' and d.id = 'plantel' and r ? 'skill'), '{}'::jsonb),
  'subs', coalesce((select jsonb_object_agg(d.id || '|' || (x->>'nome'), x->'skill')
                   from public.docs d, jsonb_array_elements(coalesce(d.data->'subs','[]'::jsonb)) x
                   where d.col = 'conv' and x ? 'skill'), '{}'::jsonb))
on conflict (col, id) do update set data = jsonb_build_object(
  'jog',  (excluded.data->'jog')  || coalesce(public.docs.data->'jog',  '{}'::jsonb),
  'subs', (excluded.data->'subs') || coalesce(public.docs.data->'subs', '{}'::jsonb));
update public.docs set data = jsonb_set(data, '{roster}',
  (select coalesce(jsonb_agg(r - 'skill'), '[]'::jsonb) from jsonb_array_elements(data->'roster') r))
where col = 'config' and id = 'plantel' and jsonb_typeof(data->'roster') = 'array';
update public.docs set data = jsonb_set(data, '{subs}',
  (select coalesce(jsonb_agg(x - 'skill'), '[]'::jsonb) from jsonb_array_elements(data->'subs') x))
where col = 'conv' and jsonb_typeof(data->'subs') = 'array';

-- ---------- Equipas automáticas no servidor ----------
-- O apontador pede as equipas sem nunca receber as skills: o servidor equilibra
-- (mesma regra da app) e devolve só quem fica em cada equipa, capitão primeiro.
--   p_lista: 14 entradas {nome, sub?}  ("Substituto" = vaga; sub = nome do substituto aprovado)
--   p_pares: {"A|B": peso} vezes que A e B jogaram juntos (recentes pesam mais)
--   p_cap:   {"Nome": n} vezes que foi capitão
create or replace function public.equipas_auto(p_data text, p_lista jsonb, p_pares jsonb, p_cap jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  sk jsonb := coalesce((select data from docs where col = 'config' and id = 'skills'), '{}'::jsonb);
  n int := jsonb_array_length(p_lista);
  v int[]; nm text[]; isreal boolean[]; e jsonb;
  tot int := 0; cnt int := 0; avg0 int; avg1 int; t int := 0; tq int := 0;
  m int; i int; j int; c int; s int; q int; best int := 1000000; r numeric;
  ms int[] := '{}'; ds int[] := '{}'; qs int[] := '{}';
  cand jsonb := '[]'::jsonb; res jsonb := '[]'::jsonb; o record; a jsonb; b jsonb; cap int;
begin
  if not (public.tem_papel('admin') or public.tem_papel('apontador')) then
    raise exception 'Sem permissão para fazer equipas';
  end if;
  if n <> 14 then raise exception 'São precisos 14 lugares'; end if;
  v := array_fill(null::int, array[n]); nm := array_fill(null::text, array[n]); isreal := array_fill(false, array[n]);
  for i in 1..n loop
    e := p_lista->(i-1); nm[i] := e->>'nome';
    if nm[i] <> 'Substituto' then
      v[i] := coalesce((sk->'jog'->>nm[i])::int, 3); isreal[i] := true; tot := tot + v[i]; cnt := cnt + 1;
    end if;
  end loop;
  avg0 := case when cnt > 0 then round(tot::numeric / cnt) else 3 end;
  for i in 1..n loop
    e := p_lista->(i-1);
    if not isreal[i] and e ? 'sub' and e->>'sub' is not null then
      v[i] := coalesce((sk->'subs'->>(p_data || '|' || (e->>'sub')))::int, avg0); tot := tot + v[i]; cnt := cnt + 1;
    end if;
  end loop;
  avg1 := case when cnt > 0 then round(tot::numeric / cnt) else 3 end;
  for i in 1..n loop if v[i] is null then v[i] := avg1; end if; t := t + v[i]; tq := tq + v[i]*v[i]; end loop;
  m := 1;
  while m < (1 << n) loop
    c := 0; s := 0; q := 0;
    for i in 1..n loop
      if (m >> (i-1)) & 1 = 1 then c := c + 1; s := s + v[i]; q := q + v[i]*v[i]; end if;
    end loop;
    if c = n/2 then
      ms := ms || m; ds := ds || abs(2*s - t); qs := qs || abs(2*q - tq);
      if abs(2*s - t) < best then best := abs(2*s - t); end if;
    end if;
    m := m + 2;
  end loop;
  for k in 1..coalesce(array_length(ms,1),0) loop
    if ds[k] <= best + 1 then
      r := 0;
      for i in 1..n loop for j in i+1..n loop
        if ((ms[k] >> (i-1)) & 1) = ((ms[k] >> (j-1)) & 1) and isreal[i] and isreal[j] then
          r := r + coalesce((p_pares->>(case when nm[i] collate "C" < nm[j] collate "C" then nm[i] || '|' || nm[j] else nm[j] || '|' || nm[i] end))::numeric, 0);
        end if;
      end loop; end loop;
      cand := cand || jsonb_build_object('m', ms[k], 'd', ds[k], 'q', qs[k], 'r', r);
    end if;
  end loop;
  for o in select (x->>'m')::int as mm from jsonb_array_elements(cand) x
           order by (x->>'r')::numeric, (x->>'d')::int, (x->>'q')::int limit 6 loop
    a := '[]'::jsonb; b := '[]'::jsonb;
    for c in 0..1 loop
      cap := null;
      for i in 1..n loop
        if ((o.mm >> (i-1)) & 1) = (1 - c) and isreal[i] and (cap is null
           or coalesce((p_cap->>nm[i])::int,0) < coalesce((p_cap->>nm[cap])::int,0)
           or (coalesce((p_cap->>nm[i])::int,0) = coalesce((p_cap->>nm[cap])::int,0) and v[i] > v[cap])) then cap := i; end if;
      end loop;
      for i in 1..n loop
        if ((o.mm >> (i-1)) & 1) = (1 - c) and i is distinct from cap then
          if c = 0 then a := a || to_jsonb(i-1); else b := b || to_jsonb(i-1); end if;
        end if;
      end loop;
      if cap is not null then
        if c = 0 then a := to_jsonb(cap-1) || a; else b := to_jsonb(cap-1) || b; end if;
      end if;
    end loop;
    res := res || jsonb_build_object('a', a, 'b', b);
  end loop;
  return res;
end $$;
revoke execute on function public.equipas_auto(text, jsonb, jsonb, jsonb) from anon;
grant execute on function public.equipas_auto(text, jsonb, jsonb, jsonb) to authenticated;

-- ---------- Tempo real ----------
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
