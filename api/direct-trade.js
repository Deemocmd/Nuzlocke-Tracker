import { supabase } from './_lib/supabase.js';
import { requireUserOrAdmin, allowCors } from './_lib/auth.js';
import { directTradeToJson } from './_lib/serialize.js';

// --------------------------------------------------------------------------
// Trueque directo: a diferencia del Intercambio prodigioso (emparejamiento
// al azar), aquí cada participante publica una oferta indicando QUÉ Pokémon
// da y QUÉ especie concreta quiere a cambio. La oferta queda visible en un
// tablón para el resto de participantes; cualquiera que tenga esa especie
// exacta (viva, en una de sus filas) puede aceptarla y el intercambio se
// resuelve al instante vía la función RPC accept_direct_trade.
// --------------------------------------------------------------------------

async function namesById(ids) {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return {};
  const { data, error } = await supabase.from('users').select('id, name').in('id', unique);
  if (error) throw error;
  const map = {};
  data.forEach((u) => { map[u.id] = u.name; });
  unique.forEach((id) => { if (!(id in map)) map[id] = 'Desconocido'; });
  return map;
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  const session = requireUserOrAdmin(req, res);
  if (!session) return;

  if (!session.userId) {
    if (req.method === 'GET') {
      res.status(200).json({ board: [], mine: [], history: [] });
      return;
    }
    res.status(403).json({ error: 'El administrador no participa de los intercambios.' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const [{ data: pending, error: e1 }, { data: mine, error: e2 }, { data: fromHist, error: e3 }, { data: toHist, error: e4 }] =
        await Promise.all([
          supabase.from('direct_trades').select('*').eq('status', 'pending'),
          supabase.from('direct_trades').select('*').eq('from_user_id', session.userId).eq('status', 'pending'),
          supabase.from('direct_trades').select('*').eq('from_user_id', session.userId).eq('status', 'completed'),
          supabase.from('direct_trades').select('*').eq('to_user_id', session.userId).eq('status', 'completed'),
        ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      if (e4) throw e4;

      const board = (pending || []).filter((t) => t.from_user_id !== session.userId);

      const seen = new Set();
      const history = [...(fromHist || []), ...(toHist || [])].filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));

      const nameMap = await namesById([
        ...board.map((t) => t.from_user_id),
        ...history.flatMap((t) => [t.from_user_id, t.to_user_id]),
      ]);

      res.status(200).json({
        board: board.map((t) => directTradeToJson(t, { fromUserName: nameMap[t.from_user_id] })),
        mine: (mine || []).map((t) => directTradeToJson(t)),
        history: history
          .map((t) => directTradeToJson(t, { fromUserName: nameMap[t.from_user_id], toUserName: nameMap[t.to_user_id] }))
          .sort((a, b) => new Date(b.resolvedAt || 0) - new Date(a.resolvedAt || 0))
          .slice(0, 20),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron cargar los trueques.' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const { routeEntryId, requestedPokemon } = req.body || {};
      const wanted = String(requestedPokemon || '').trim();
      if (!routeEntryId || !wanted) {
        res.status(400).json({ error: 'Elige qué Pokémon ofreces y qué especie pides a cambio.' });
        return;
      }
      if (wanted.length > 40) {
        res.status(400).json({ error: 'El nombre pedido es demasiado largo.' });
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

      const { data: created, error: insertError } = await supabase
        .from('direct_trades')
        .insert({
          from_user_id: session.userId,
          from_route_entry_id: routeEntryId,
          offered_pokemon: routeRow.pokemon_name,
          offered_route_name: routeRow.route,
          requested_pokemon: wanted,
          status: 'pending',
        })
        .select()
        .single();
      if (insertError) throw insertError;
      res.status(201).json(directTradeToJson(created));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo publicar la oferta.' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const { offerId, routeEntryId } = req.body || {};
      if (!offerId || !routeEntryId) {
        res.status(400).json({ error: 'Elige con cuál de tus Pokémon aceptas el trueque.' });
        return;
      }

      const { data: result, error: rpcError } = await supabase.rpc('accept_direct_trade', {
        p_offer_id: offerId,
        p_my_user_id: session.userId,
        p_my_route_id: routeEntryId,
      });

      if (rpcError) {
        const map = {
          OFFER_GONE: 'Esa oferta ya no está disponible.',
          OWN_OFFER: 'No puedes aceptar tu propia oferta.',
          NOT_MINE: 'Esa fila no te pertenece.',
          NOT_ALIVE: 'Elige un Pokémon vivo con especie asignada.',
          SPECIES_MISMATCH: 'Ese Pokémon no es la especie que se pide en la oferta.',
        };
        const key = Object.keys(map).find((k) => rpcError.message?.includes(k));
        if (key) {
          res.status(409).json({ error: map[key] });
          return;
        }
        throw rpcError;
      }

      res.status(200).json({ ok: true, ...result });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo aceptar el trueque.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) {
        res.status(400).json({ error: 'Falta el id de la oferta.' });
        return;
      }
      const { data, error } = await supabase
        .from('direct_trades')
        .delete()
        .eq('id', id)
        .eq('from_user_id', session.userId)
        .eq('status', 'pending')
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        res.status(404).json({ error: 'Esa oferta no existe o ya no se puede cancelar.' });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cancelar la oferta.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
