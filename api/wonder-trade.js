import { supabase } from './_lib/supabase.js';
import { requireUserOrAdmin, allowCors } from './_lib/auth.js';
import { wonderTradeToJson } from './_lib/serialize.js';

// --------------------------------------------------------------------------
// Intercambios prodigiosos (Wonder Trade)
//
// Cualquier participante puede ofrecer uno de sus Pokémon vivos. Si en ese
// momento ya hay otra oferta pendiente de OTRO participante, se emparejan al
// instante (vía la función RPC resolve_wonder_trade, que hace el intercambio
// de forma atómica). Si no hay nadie esperando, su oferta queda "en cola"
// hasta que otro participante mande la suya.
// --------------------------------------------------------------------------

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  const session = requireUserOrAdmin(req, res);
  if (!session) return;

  if (!session.userId) {
    // El administrador no tiene ficha propia, así que no participa del pool.
    if (req.method === 'GET') {
      res.status(200).json({ pending: null, history: [] });
      return;
    }
    res.status(403).json({ error: 'El administrador no participa de los intercambios.' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const { data: pendingRows, error: pendingError } = await supabase
        .from('wonder_trades')
        .select('*')
        .eq('user_id', session.userId)
        .eq('status', 'pending')
        .limit(1);
      if (pendingError) throw pendingError;

      const { data: historyRows, error: historyError } = await supabase
        .from('wonder_trades')
        .select('*')
        .eq('user_id', session.userId)
        .eq('status', 'completed')
        .order('resolved_at', { ascending: false })
        .limit(20);
      if (historyError) throw historyError;

      res.status(200).json({
        pending: pendingRows[0] ? wonderTradeToJson(pendingRows[0]) : null,
        history: historyRows.map(wonderTradeToJson),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron cargar los intercambios.' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const { routeEntryId } = req.body || {};
      if (!routeEntryId) {
        res.status(400).json({ error: 'Elige qué Pokémon quieres ofrecer.' });
        return;
      }

      const { data: routeRow, error: routeError } = await supabase
        .from('route_entries').select('*').eq('id', routeEntryId).maybeSingle();
      if (routeError) throw routeError;
      if (!routeRow || routeRow.user_id !== session.userId) {
        res.status(404).json({ error: 'Esa fila no te pertenece.' });
        return;
      }
      if (routeRow.status !== 'Vivo' || !routeRow.pokemon_name || !routeRow.pokemon_name.trim()) {
        res.status(400).json({ error: 'Solo puedes ofrecer un Pokémon vivo con especie asignada.' });
        return;
      }

      // Si ya tenías una oferta pendiente, la reemplazamos por esta.
      await supabase.from('wonder_trades').delete().eq('user_id', session.userId).eq('status', 'pending');

      // Buscamos una oferta pendiente de otro participante.
      const { data: candidates, error: candError } = await supabase
        .from('wonder_trades')
        .select('*')
        .eq('status', 'pending')
        .neq('user_id', session.userId);
      if (candError) throw candError;

      if (!candidates || candidates.length === 0) {
        // Nadie esperando: dejamos nuestra oferta en cola.
        const { data: created, error: insertError } = await supabase
          .from('wonder_trades')
          .insert({
            user_id: session.userId,
            route_entry_id: routeEntryId,
            pokemon_name: routeRow.pokemon_name,
            route_name: routeRow.route,
            status: 'pending',
          })
          .select()
          .single();
        if (insertError) throw insertError;
        res.status(201).json({ matched: false, pending: wonderTradeToJson(created) });
        return;
      }

      // Emparejamos con una oferta al azar entre las disponibles.
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];

      const { data: result, error: rpcError } = await supabase.rpc('resolve_wonder_trade', {
        p_my_user_id: session.userId,
        p_my_route_id: routeEntryId,
        p_candidate_trade_id: chosen.id,
      });

      if (rpcError) {
        if (rpcError.message?.includes('PARTNER_GONE')) {
          res.status(409).json({ error: 'Esa oferta ya no está disponible, inténtalo de nuevo.' });
          return;
        }
        throw rpcError;
      }

      res.status(200).json({ matched: true, received: result.received, offered: result.offered });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo procesar el intercambio.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const { error } = await supabase
        .from('wonder_trades').delete().eq('user_id', session.userId).eq('status', 'pending');
      if (error) throw error;
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cancelar la oferta.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
