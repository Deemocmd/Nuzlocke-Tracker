import { createClient } from '@supabase/supabase-js';

// En entornos serverless (Vercel) cada invocación puede reutilizar el mismo
// contenedor; creamos el cliente a nivel de módulo para no reconstruirlo en
// cada invocación "caliente" (equivalente al getApps().length de Firebase).

const supabaseUrl = process.env.SUPABASE_URL;
// La Service Role Key tiene permisos totales y se salta RLS: úsala SOLO en
// el backend (estas funciones de /api), nunca en el bundle del frontend.
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Faltan variables de entorno de Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Nombres de las tablas de Postgres (equivalentes a las colecciones de
// Firestore que usaba la versión anterior).
export const TABLES = {
  users: 'users',
  routeEntries: 'route_entries',
  news: 'news_posts',
  wonderTrades: 'wonder_trades',
  swissBracket: 'swiss_bracket',
};
