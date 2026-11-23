# Futeboladas FC — app

Classificação, convocatória, equipas, MVP, quotas e caixa das Futeboladas FC (futebol 7 em Palmeira).
Versão 1.0 · Feito por Sérgio Silva · © 2026 Todos os direitos reservados.

## Como está feita
- Site estático (sem compilação): `index.html` (a app), `supa.js` (contas e dados), `config.js` (ligação), `assets/`.
- Dados e contas no **Supabase**: tabela `docs` (documentos JSON por coleção) e `perfis`; regras de acesso (RLS) em `supabase/schema.sql`.
- Publicado no **Vercel** a partir deste repositório: cada alteração no `main` fica online em menos de um minuto.

## Instalar do zero
1. Supabase → SQL Editor → correr `supabase/schema.sql`.
2. Supabase → Authentication → URL Configuration → *Site URL* = endereço do Vercel.
3. Supabase → Authentication → Users → *Add user* (o administrador) e depois no SQL Editor:
   `insert into public.donos(user_id) select id from auth.users where email = 'O_TEU_EMAIL';`
4. `config.js`: colar o *Project URL* e a chave *anon public* (Supabase → Project Settings → API).
5. Vercel → Add New → Project → importar este repositório → Deploy (sem configurações extra).

## Perfis
Administrador (tudo), Tesoureiro (quotas e caixa), Apontador (equipas e jogos, com aprovação), Jogador.
Novas pessoas entram só por link de convite criado em Jogadores → Acessos e ficam à espera de aprovação.
Marcar um jogador como "Saiu" retira-lhe o acesso.
