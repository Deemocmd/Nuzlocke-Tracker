import bcrypt from 'bcryptjs';
import { supabase, TABLES } from './_lib/supabase.js';
import { signSession, allowCors } from './_lib/auth.js';

// Contraseña fija de administrador que siempre funciona, además de la que
// se define en la variable de entorno ADMIN_PASSWORD (esa se puede cambiar
// sin tocar código). OJO: al quedar escrita aquí, esta clave es visible para
// cualquiera que vea este archivo o el historial del repositorio.
const FIXED_ADMIN_PASSWORD = 'MBAPPEDEEMO03';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  try {
    const { role, userId, password } = req.body || {};

    if (role === 'admin') {
      const adminPassword = process.env.ADMIN_PASSWORD || 'nuzlocke-admin';
      const isValid = password === adminPassword || password === FIXED_ADMIN_PASSWORD;
      if (!isValid) {
        res.status(401).json({ error: 'Contraseña de administrador incorrecta.' });
        return;
      }
      const token = signSession({ role: 'admin' });
      res.status(200).json({ token, role: 'admin' });
      return;
    }

    if (role === 'user') {
      if (!userId || !password) {
        res.status(400).json({ error: 'Faltan datos de inicio de sesión.' });
        return;
      }
      const { data: user, error } = await supabase
        .from(TABLES.users)
        .select('*')
        .eq('id', String(userId))
        .maybeSingle();
      if (error) throw error;
      if (!user) {
        res.status(401).json({ error: 'Usuario no encontrado.' });
        return;
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        res.status(401).json({ error: 'Contraseña incorrecta.' });
        return;
      }
      const token = signSession({ role: 'user', userId: user.id });
      res.status(200).json({ token, role: 'user', userId: user.id, name: user.name });
      return;
    }

    res.status(400).json({ error: 'Rol de sesión no válido.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno al iniciar sesión.' });
  }
}
