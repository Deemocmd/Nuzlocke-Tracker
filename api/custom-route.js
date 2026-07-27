import { supabase, TABLES } from './_lib/supabase.js';
import { requireUserOrAdmin, allowCors } from './_lib/auth.js';
import { serializeRoute } from './_lib/serialize.js';

// --------------------------------------------------------------------------
// Filas personalizadas de la ficha Nuzlocke: cada participante puede
// agregarse (o borrarse) filas extra además de sus 62 rutas fijas de Hoenn.
// Solo el dueño de la ficha puede tocar sus propias filas personalizadas.
// --------------------------------------------------------------------------

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  const session = requireUserOrAdmin(req, res);
  if (!session) return;

  if (!session.userId) {
    res.status(403).json({ error: 'El administrador no tiene una ficha propia.' });
    return;
  }

  if (req.method === 'POST') {
    try {
      const { route } = req.body || {};
      const trimmed = String(route || '').trim();
      if (!trimmed) {
        res.status(400).json({ error: 'Escribe un nombre para la fila.' });
        return;
      }
      if (trimmed.length > 60) {
        res.status(400).json({ error: 'El nombre es demasiado largo.' });
        return;
      }

      const { data: existing, error: existErr } = await supabase
        .from(TABLES.routeEntries)
        .select('order_index')
        .eq('user_id', session.userId);
      if (existErr) throw existErr;
      const maxIndex = existing.reduce((max, r) => Math.max(max, r.order_index || 0), 0);
      const nextIndex = maxIndex + 1;

      const { data: inserted, error } = await supabase
        .from(TABLES.routeEntries)
        .insert({
          user_id: session.userId,
          order_index: nextIndex,
          route: trimmed,
          pokemon_name: null,
          nickname: '',
          level: null,
          nature: '',
          status: 'Vivo',
          ability: '',
          item: '',
          notes: '',
          is_custom: true,
        })
        .select()
        .single();
      if (error) throw error;

      res.status(201).json(serializeRoute(inserted));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo agregar la fila.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) {
        res.status(400).json({ error: 'Falta el id de la fila.' });
        return;
      }

      const { data: row, error } = await supabase
        .from(TABLES.routeEntries)
        .select('*')
        .eq('id', String(id))
        .maybeSingle();
      if (error) throw error;
      if (!row || row.user_id !== session.userId) {
        res.status(404).json({ error: 'Esa fila no existe o no te pertenece.' });
        return;
      }
      if (!row.is_custom) {
        res.status(403).json({ error: 'Solo puedes eliminar filas que hayas agregado tú mismo.' });
        return;
      }

      const { error: delErr } = await supabase.from(TABLES.routeEntries).delete().eq('id', String(id));
      if (delErr) throw delErr;

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo eliminar la fila.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
