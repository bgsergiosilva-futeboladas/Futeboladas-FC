// Ligação ao Supabase.
// Supabase → Project Settings → API (ou "Data API"): copia o "Project URL" e a chave "anon public".
// A chave anon é pública por natureza: quem protege os dados são as regras (RLS) do schema.sql.
export const SUPABASE_URL = 'COLOCA_AQUI_O_PROJECT_URL';      // ex.: https://abcdefgh.supabase.co
export const SUPABASE_ANON_KEY = 'COLOCA_AQUI_A_CHAVE_ANON';
