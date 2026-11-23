// Ligação ao Supabase.
// Supabase → Project Settings → API (ou "Data API"): copia o "Project URL" e a chave "anon public".
// A chave anon é pública por natureza: quem protege os dados são as regras (RLS) do schema.sql.
export const SUPABASE_URL = 'https://hbjlygnunutttgvkjqcw.supabase.co';      // ex.: https://abcdefgh.supabase.co
export const SUPABASE_ANON_KEY = 'sb_publishable_iedFjVn_DOM312nQZfSezA_53pfLYft';
// Chave pública das notificações (a privada fica só nos segredos do Supabase)
export const VAPID_PUBLIC = 'BIDFOC6WBdrq8ogffMSvXeshQNQcfVVKLgWqBGuQiazN9hDwQ6AFVCxEq0WKxFLEuqWq0eTA1HaC6G557Yn5bKQ';
