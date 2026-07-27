import { supabase, TABLES } from './_lib/supabase.js';
import { requireUserOrAdmin, allowCors } from './_lib/auth.js';
import { serializeTrade } from './_lib/serialize.js';

// --------------------------------------------------------------------------
// Intercambios prodigiosos (Wonder Trade)
//
// Cualquier participante puede ofrecer uno de sus Pokémon vivos. Si en ese
// momento ya hay otra oferta pendiente de OTRO participante, se emparejan al
// instante y cada uno recibe el Pokémon del otro en la misma fila de ruta
// que ofreció. Si no hay nadie esperando, su oferta queda "en cola" hasta
// que otro participante mande la suya. El emparejamiento vive en la función
// SQL wonder_trade_offer para que sea atómico incluso con varias ofertas
// simultáneas (usa "for update skip locked").
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
      const { data: pendingRows, error: pendingErr } = await supabase
        .from(TABLES.wonderTrades)
        .select('*')
        .eq('user_id', session.userId)
        .eq('status', 'pending')
        .limit(1);
      if (pendingErr) throw pendingErr;
      const pending = pendingRows.length ? serializeTrade(pendingRows[0]) : null;

      const { data: historyRows, error: historyErr } = await supabase
        .from(TABLES.wonderTrades)
        .select('*')
        .eq('user_id', session.userId)
        .eq('status', 'completed')
        .order('resolved_at', { ascending: false })
        .limit(20);
      if (historyErr) throw historyErr;
      const history = historyRows.map(serializeTrade);

      res.status(200).json({ pending, history });
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

      const { data, error } = await supabase.rpc('wonder_trade_offer', {
        p_user_id: session.userId,
        p_route_entry_id: String(routeEntryId),
      });

      if (error) {
        if (error.message?.includes('NOT_OWNED')) {
          res.status(404).json({ error: 'Esa fila no te pertenece.' });
          return;
        }
        if (error.message?.includes('INVALID_OFFER')) {
          res.status(400).json({ error: 'Solo puedes ofrecer un Pokémon vivo con especie asignada.' });
          return;
        }
        if (error.message?.includes('PARTNER_GONE')) {
          res.status(409).json({ error: 'Esa oferta ya no está disponible, inténtalo de nuevo.' });
          return;
        }
        throw error;
      }

      res.status(data.matched ? 200 : 201).json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo procesar el intercambio.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const { error } = await supabase
        .from(TABLES.wonderTrades)
        .delete()
        .eq('user_id', session.userId)
        .eq('status', 'pending');
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
