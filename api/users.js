import bcrypt from 'bcryptjs';
import { supabase, TABLES } from './_lib/supabase.js';
import { requireAdmin, allowCors } from './_lib/auth.js';
import { HOENN_LOCATIONS, USER_COLOR_POOL } from '../shared/constants.js';
import { serializeRoute, serializeUser } from './_lib/serialize.js';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method === 'GET') {
    try {
      const { data: users, error } = await supabase
        .from(TABLES.users)
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;

      const result = await Promise.all(
        users.map(async (u) => {
          const { data: routes, error: routesErr } = await supabase
            .from(TABLES.routeEntries)
            .select('*')
            .eq('user_id', u.id)
            .order('order_index', { ascending: true });
          if (routesErr) throw routesErr;
          // Nunca devolvemos la contraseña al cliente.
          return serializeUser(u, routes.map(serializeRoute));
        })
      );

      res.status(200).json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron cargar los participantes.' });
    }
    return;
  }

  if (req.method === 'POST') {
    const session = requireAdmin(req, res);
    if (!session) return;

    try {
      const { name, password } = req.body || {};
      const trimmedName = String(name || '').trim();
      if (!trimmedName || !password) {
        res.status(400).json({ error: 'Escribe un nombre y una contraseña.' });
        return;
      }

      const { data: existing, error: existErr } = await supabase
        .from(TABLES.users)
        .select('id')
        .eq('name', trimmedName)
        .limit(1);
      if (existErr) throw existErr;
      if (existing.length) {
        res.status(409).json({ error: 'Ya existe un participante con ese nombre.' });
        return;
      }

      const { count, error: countErr } = await supabase
        .from(TABLES.users)
        .select('*', { count: 'exact', head: true });
      if (countErr) throw countErr;

      const color = USER_COLOR_POOL[(count || 0) % USER_COLOR_POOL.length];
      const hashed = await bcrypt.hash(String(password), 10);
      const routesPayload = HOENN_LOCATIONS.map((route, i) => ({ orderIndex: i + 1, route }));

      // create_participant crea el usuario y sus 62 filas de ruta en una
      // sola transacción de Postgres (equivalente al batch de Firestore).
      const { data, error } = await supabase.rpc('create_participant', {
        p_name: trimmedName,
        p_password: hashed,
        p_color: color,
        p_routes: routesPayload,
      });
      if (error) throw error;

      res.status(201).json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo crear el participante.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    const session = requireAdmin(req, res);
    if (!session) return;
    try {
      const { id } = req.query;
      if (!id) {
        res.status(400).json({ error: 'Falta el id del participante.' });
        return;
      }

      // route_entries tiene ON DELETE CASCADE sobre user_id, así que borrar
      // el usuario ya se lleva sus filas de ruta consigo.
      const { error } = await supabase.from(TABLES.users).delete().eq('id', String(id));
      if (error) throw error;

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo eliminar el participante.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
