import bcrypt from 'bcryptjs';
import { supabase } from './_lib/supabase.js';
import { requireAdmin, allowCors } from './_lib/auth.js';
import { HOENN_LOCATIONS, USER_COLOR_POOL } from '../shared/constants.js';
import { userToJson, routeToJson } from './_lib/serialize.js';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method === 'GET') {
    try {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: true });
      if (usersError) throw usersError;

      const { data: routes, error: routesError } = await supabase
        .from('route_entries')
        .select('*')
        .order('order_index', { ascending: true });
      if (routesError) throw routesError;

      const routesByUser = {};
      for (const r of routes) {
        (routesByUser[r.user_id] ||= []).push(routeToJson(r));
      }

      res.status(200).json(users.map((u) => userToJson(u, routesByUser[u.id] || [])));
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

      const { count, error: countError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });
      if (countError) throw countError;

      const color = USER_COLOR_POOL[(count || 0) % USER_COLOR_POOL.length];
      const hashed = await bcrypt.hash(String(password), 10);

      const { data: newUserId, error: rpcError } = await supabase.rpc('create_user_with_routes', {
        p_name: trimmedName,
        p_password: hashed,
        p_color: color,
        p_routes: HOENN_LOCATIONS,
      });

      if (rpcError) {
        if (rpcError.message?.includes('DUPLICATE_NAME')) {
          res.status(409).json({ error: 'Ya existe un participante con ese nombre.' });
          return;
        }
        throw rpcError;
      }

      const { data: user, error: userError } = await supabase
        .from('users').select('*').eq('id', newUserId).single();
      if (userError) throw userError;

      const { data: routes, error: routesError } = await supabase
        .from('route_entries').select('*').eq('user_id', newUserId).order('order_index', { ascending: true });
      if (routesError) throw routesError;

      res.status(201).json(userToJson(user, routes.map(routeToJson)));
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
      // route_entries tiene ON DELETE CASCADE sobre user_id: basta con
      // borrar el usuario para que sus filas de ruta se borren solas.
      const { error } = await supabase.from('users').delete().eq('id', id);
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
