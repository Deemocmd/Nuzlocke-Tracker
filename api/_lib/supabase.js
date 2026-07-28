import { createClient } from '@supabase/supabase-js';

// Usamos la Service Role Key SOLO aquí (backend, funciones serverless de
// Vercel). Esa clave se salta Row Level Security, así que NUNCA debe
// exponerse al frontend ni llevar el prefijo VITE_.
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'Faltan variables de entorno de Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).'
  );
}

export const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
