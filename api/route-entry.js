import { supabase } from './_lib/supabase.js';
import { requireUserOrAdmin, allowCors } from './_lib/auth.js';
import { routeToJson, userToJson } from './_lib/serialize.js';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'PUT') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const session = requireUserOrAdmin(req, res);
  if (!session) return;

  try {
    const { id } = req.query;
    if (!id) {
      res.status(400).json({ error: 'Falta el id de la fila de ruta.' });
      return;
    }

    const { pokemonName, nickname, level, nature, status, ability, item, notes } = req.body || {};

    const { data: rpcResult, error: rpcError } = await supabase.rpc('update_route_entry', {
      p_route_id: id,
      p_is_admin: session.role === 'admin',
      p_session_user_id: session.userId || null,
      p_pokemon_name: pokemonName ?? null,
      p_nickname: nickname ?? '',
      p_level: level === '' || level === undefined ? null : Number(level),
      p_nature: nature ?? '',
      p_status: status ?? null,
      p_ability: ability ?? '',
      p_item: item ?? '',
      p_notes: notes ?? '',
    });

    if (rpcError) {
      if (rpcError.message?.includes('NOT_FOUND')) {
        res.status(404).json({ error: 'Fila de ruta no encontrada.' });
        return;
      }
      if (rpcError.message?.includes('FORBIDDEN')) {
        res.status(403).json({ error: 'No puedes editar la ficha de otro participante.' });
        return;
      }
      throw rpcError;
    }

    const { data: route, error: routeError } = await supabase
      .from('route_entries').select('*').eq('id', id).single();
    if (routeError) throw routeError;

    let user = null;
    if (rpcResult.livesChanged) {
      const { data: userRow, error: userError } = await supabase
        .from('users').select('*').eq('id', rpcResult.userId).single();
      if (userError) throw userError;
      user = userToJson(userRow);
    }

    res.status(200).json({ updated: routeToJson(route), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar la ficha.' });
  }
}
