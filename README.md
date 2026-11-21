# Futeboladas FC

App das Futeboladas FC (futebol 7, quintas às 21h00 em Palmeira): classificação, jogos, convocatória, equipas automáticas e quotas.

- **Site estático** (HTML + JavaScript, sem build), alojado no **Vercel**
- **Supabase** para a base de dados e os logins (email + password)
- Três perfis, protegidos na base de dados:
  - **Administrador**: tudo (jogos, jogadores, convocatória, equipas, acessos, quotas)
  - **Tesoureiro**: quotas, despesas e saldo; vê o resto
  - **Jogador**: vê tudo e responde à convocatória (só o seu próprio voto)

## Estrutura

```
index.html              página da app (estilos incluídos)
app.js                  interface, login e ligação ao Supabase
engine.js               regras: pontos, classificação, quotas, equilíbrio de equipas
config.js               URL e chave pública do Supabase  ← preencher
manifest.webmanifest    para instalar no telemóvel como app
assets/                 emblema e ícones
supabase/schema.sql     tabelas, regras de acesso (RLS) e tempo real
supabase/seed.sql       dados iniciais: 21 jogos, plantel, quotas desde dez/2025, saldo 194,79 €
vercel.json             configuração do Vercel
```

## Instalação (uma vez)

### 1. Supabase
1. Cria conta em supabase.com → **New project** (região Europa, por ex. Frankfurt ou Paris). Guarda a password da base de dados.
2. **SQL Editor → New query**: cola o conteúdo de `supabase/schema.sql` → **Run**.
3. Nova query com `supabase/seed.sql` → **Run**.
4. **Project Settings → API**: copia o *Project URL* e a chave *anon public* para o `config.js`.

### 2. GitHub
1. Cria um repositório (pode ser privado), por ex. `futeboladas-fc`.
2. Carrega todos os ficheiros desta pasta (Add file → Upload files) ou:
   ```
   git init && git add . && git commit -m "Futeboladas FC"
   git branch -M main
   git remote add origin https://github.com/<utilizador>/futeboladas-fc.git
   git push -u origin main
   ```

### 3. Vercel
1. vercel.com → **Add New → Project** → importa o repositório.
2. Framework Preset: **Other**. Sem build command. Output directory: a raiz (deixa vazio).
3. **Deploy**. Fica com um endereço tipo `https://futeboladas-fc.vercel.app`.

### 4. Ligar o login ao endereço do Vercel
No Supabase, **Authentication → URL Configuration**:
- *Site URL*: o endereço do Vercel
- *Redirect URLs*: o mesmo endereço

(É para onde apontam os emails de confirmação de conta e de recuperação de password.)

### 5. Tornar-te administrador
1. Abre a app e **cria conta** com o teu email. Confirma o email.
2. No Supabase, **SQL Editor**:
   ```sql
   update public.perfis
      set papel = 'admin', jogador = 'Sérgio Silva'
    where email = 'o-teu-email@exemplo.pt';
   ```
3. Volta a entrar na app.

### 6. Convidar os outros
Envia o endereço da app. Cada um cria conta, confirma o email e escolhe o seu nome. Tu aprovas em **Jogadores → Acessos** e escolhes o perfil (Jogador ou Tesoureiro).

No telemóvel: abrir no Safari/Chrome → Partilhar / menu → **Adicionar ao ecrã principal**.

## Regras

- Pontos: vitória 3, empate 1, derrota 0; +1 por vitória como capitão (1.º jogador da equipa); −1 por atraso. Desempate pela % de vitórias.
- Convidados e "Substituto" não entram na classificação.
- "Não houve jogo" não conta para o total de jogos.
- Convocatória: os primeiros 14 a confirmar jogam; os seguintes ficam suplentes.
- Equipas: só com confirmados; divisão 7×7 mais equilibrada pela skill (0–5). Entre as equilibradas, escolhe a que menos repete duplas de jogos anteriores (os jogos recentes pesam mais). Capitão: quem foi capitão menos vezes. Ao publicar, sorteia quem joga de coletes.
- Quotas: alternam 20 € / 15 € (novembro 2026 = 15 €), editáveis por mês. Quem entra paga a partir do mês de entrada; quem sai deixa de pagar depois do mês de saída.

## Notas

- O plano gratuito do Supabase pausa projetos sem atividade durante 7 dias; com jogos todas as semanas não deve acontecer. Se acontecer, basta reativar no painel.
- O envio de emails do Supabase (confirmação/recuperação) tem limites baixos por hora no plano gratuito. Para muitas contas de uma vez, configura um SMTP próprio em Authentication → SMTP.
- Cópia de segurança: Jogadores → Cópia de segurança (texto JSON), além das cópias do próprio Supabase.
