-- Futeboladas FC — esquema da base de dados (Supabase / PostgreSQL)
-- Correr uma vez no Supabase: SQL Editor → New query → colar → Run.

-- 1. Perfis: uma linha por conta, criada automaticamente quando alguém se regista
create table if not exists public.perfis (
  user_id        uuid primary key references auth.users on delete cascade,
  email          text,
  jogador        text,                 -- nome do jogador associado (aprovado pelo admin)
  jogador_pedido text,                 -- nome que a pessoa escolheu ao pedir acesso
  papel          text check (papel in ('admin','tesoureiro','jogador')),  -- null = à espera de aprovação
  criado         timestamptz not null default now()
);

-- 2. Dados da app: documentos JSON agrupados por coleção
--    config/plantel, config/campo, config/caixa, jogos/gAAAAMMDD, conv/AAAA-MM-DD,
--    votos/<user_id>, pagamentos/AAAA-MM
create table if not exists public.docs (
  col        text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);

-- Papel de quem está a usar a app
create or replace function public.meu_papel() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.perfis where user_id = auth.uid()
$$;

-- Cria o perfil quando alguém se regista
create or replace function public.novo_utilizador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (user_id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;
drop trigger if exists ao_criar_utilizador on auth.users;
create trigger ao_criar_utilizador after insert on auth.users
  for each row execute function public.novo_utilizador();

-- Pedido de acesso: a própria pessoa só pode escolher o nome, nunca o papel
create or replace function public.pedir_acesso(j text) returns void
language sql security definer set search_path = public as $$
  update public.perfis set jogador_pedido = j where user_id = auth.uid() and papel is null
$$;

-- Atualiza updated_at
create or replace function public.tocar() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists docs_tocar on public.docs;
create trigger docs_tocar before update on public.docs for each row execute function public.tocar();

-- 3. Regras de acesso (Row Level Security)
alter table public.perfis enable row level security;
alter table public.docs   enable row level security;

drop policy if exists "perfil próprio ou admin" on public.perfis;
create policy "perfil próprio ou admin" on public.perfis for select to authenticated
  using (user_id = auth.uid() or public.meu_papel() = 'admin');
drop policy if exists "admin altera perfis" on public.perfis;
create policy "admin altera perfis" on public.perfis for update to authenticated
  using (public.meu_papel() = 'admin') with check (public.meu_papel() = 'admin');
drop policy if exists "admin apaga perfis" on public.perfis;
create policy "admin apaga perfis" on public.perfis for delete to authenticated
  using (public.meu_papel() = 'admin');

-- Quem tem conta lê os dados (classificação, jogos, convocatória, quotas)
drop policy if exists "ler dados" on public.docs;
create policy "ler dados" on public.docs for select to authenticated using (true);
-- Administrador escreve tudo
drop policy if exists "admin escreve tudo" on public.docs;
create policy "admin escreve tudo" on public.docs for all to authenticated
  using (public.meu_papel() = 'admin') with check (public.meu_papel() = 'admin');
-- Tesoureiro escreve quotas, movimentos e saldo inicial
drop policy if exists "tesoureiro escreve quotas" on public.docs;
create policy "tesoureiro escreve quotas" on public.docs for all to authenticated
  using (public.meu_papel() = 'tesoureiro' and (col = 'pagamentos' or (col = 'config' and id = 'caixa')))
  with check (public.meu_papel() = 'tesoureiro' and (col = 'pagamentos' or (col = 'config' and id = 'caixa')));
-- Cada jogador aprovado só escreve o seu próprio voto na convocatória
drop policy if exists "cada um vota por si" on public.docs;
create policy "cada um vota por si" on public.docs for all to authenticated
  using (col = 'votos' and id = auth.uid()::text and public.meu_papel() is not null)
  with check (col = 'votos' and id = auth.uid()::text and public.meu_papel() is not null);

-- 4. Atualizações em tempo real
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.perfis;
exception when duplicate_object then null; end $$;
