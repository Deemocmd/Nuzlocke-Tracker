import { supabase } from './_lib/supabase.js';
import { requireAdmin, allowCors } from './_lib/auth.js';
import { randomUUID } from 'crypto';

// --------------------------------------------------------------------------
// Playoffs (eliminación directa a partido único). Independiente del Torneo
// Oficial: el administrador elige manualmente quiénes participan y puede
// reorganizar los emparejamientos con la acción "swap". Se guarda como una
// única fila ("main") en la tabla playoff_bracket.
// --------------------------------------------------------------------------

const DOC_ID = 'main';
const MAX_SIZE = 32;

function nextPowerOfTwo(n) {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

// Orden de siembra clásico de un cuadro de eliminación directa (1 vs último,
// 2 vs penúltimo, etc., evitando que los mejores sembrados se crucen antes
// de la final).
function seedOrder(size) {
  let seeds = [1];
  while (seeds.length < size) {
    const n = seeds.length * 2;
    const next = [];
    seeds.forEach((s) => { next.push(s); next.push(n + 1 - s); });
    seeds = next;
  }
  return seeds;
}

function propagate(rounds) {
  for (let r = 0; r < rounds.length - 1; r++) {
    rounds[r].forEach((m, i) => {
      const targetIndex = Math.floor(i / 2);
      const slot = i % 2 === 0 ? 'p1' : 'p2';
      rounds[r + 1][targetIndex][slot] = m.winner || undefined;
    });
    rounds[r + 1].forEach((m) => {
      if (m.winner && m.winner !== m.p1 && m.winner !== m.p2) m.winner = null;
    });
  }
}

function buildRounds(orderedIds, size) {
  const order = seedOrder(size);
  const slots = order.map((seed) => orderedIds[seed - 1] ?? null);
  const counts = [];
  for (let c = size / 2; c >= 1; c /= 2) counts.push(c);
  const rounds = counts.map((c) => Array.from({ length: c }, () => ({ id: randomUUID(), p1: undefined, p2: undefined, winner: null })));
  rounds[0] = rounds[0].map((m, i) => {
    const p1 = slots[i * 2] ?? null;
    const p2 = slots[i * 2 + 1] ?? null;
    let winner = null;
    if (p1 && !p2) winner = p1;
    else if (!p1 && p2) winner = p2;
    return { id: m.id, p1, p2, winner };
  });
  propagate(rounds);
  return rounds;
}

function findMatch(rounds, matchId) {
  for (let ri = 0; ri < rounds.length; ri++) {
    const mi = rounds[ri].findIndex((m) => m.id === matchId);
    if (mi !== -1) return { ri, mi };
  }
  return null;
}

async function loadPlayoff() {
  const { data, error } = await supabase.from('playoff_bracket').select('*').eq('id', DOC_ID).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { title: data.title, status: data.status, participants: data.participants, rounds: data.rounds };
}

async function savePlayoff(p) {
  const { error } = await supabase.from('playoff_bracket').upsert({
    id: DOC_ID,
    title: p.title || 'Playoffs',
    status: p.status,
    participants: p.participants,
    rounds: p.rounds,
  });
  if (error) throw error;
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method === 'GET') {
    try {
      const playoff = await loadPlayoff();
      res.status(200).json(playoff ? { id: DOC_ID, ...playoff } : null);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron cargar los playoffs.' });
    }
    return;
  }

  // Generar, actualizar resultados o reiniciar los playoffs es exclusivo
  // del administrador; el resto de la gente solo puede verlos.
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'POST') {
    try {
      const { title, participantIds } = req.body || {};
      const ids = Array.isArray(participantIds) ? participantIds.filter(Boolean) : [];
      if (ids.length < 2) {
        res.status(400).json({ error: 'Selecciona al menos 2 participantes.' });
        return;
      }

      const { data: users, error: usersErr } = await supabase
        .from('users').select('id, name, color').in('id', ids);
      if (usersErr) throw usersErr;
      const userMap = {};
      users.forEach((u) => { userMap[u.id] = u; });

      const ordered = ids.filter((id) => userMap[id]);
      if (ordered.length < 2) {
        res.status(400).json({ error: 'Hacen falta al menos 2 participantes válidos.' });
        return;
      }

      const bracketSize = Math.max(2, Math.min(MAX_SIZE, nextPowerOfTwo(ordered.length)));

      const participants = ordered.map((id) => ({
        id,
        name: userMap[id].name,
        color: userMap[id].color,
      }));

      const rounds = buildRounds(ordered, bracketSize);
      const playoff = { title: title || 'Playoffs', status: 'active', participants, rounds };
      await savePlayoff(playoff);
      res.status(201).json({ id: DOC_ID, ...playoff });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo generar el cuadro de playoffs.' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const playoff = await loadPlayoff();
      if (!playoff) {
        res.status(404).json({ error: 'Todavía no hay playoffs generados.' });
        return;
      }
      const { action } = req.body || {};

      if (action === 'setWinner') {
        const { matchId, winnerId } = req.body;
        const loc = findMatch(playoff.rounds, matchId);
        if (!loc) { res.status(404).json({ error: 'Combate no encontrado.' }); return; }
        const match = playoff.rounds[loc.ri][loc.mi];
        if (winnerId !== null && winnerId !== match.p1 && winnerId !== match.p2) {
          res.status(400).json({ error: 'Ese jugador no está en este combate.' });
          return;
        }
        match.winner = winnerId;
        propagate(playoff.rounds);
        const lastRound = playoff.rounds[playoff.rounds.length - 1];
        playoff.status = lastRound[0].winner ? 'finished' : 'active';
        await savePlayoff(playoff);
        res.status(200).json({ id: DOC_ID, ...playoff });
        return;
      }

      if (action === 'swap') {
        if (playoff.status !== 'active') {
          res.status(400).json({ error: 'Solo se pueden mover jugadores mientras los playoffs están activos.' });
          return;
        }
        const { matchIdA, slotA, matchIdB, slotB } = req.body;
        if (!['p1', 'p2'].includes(slotA) || !['p1', 'p2'].includes(slotB)) {
          res.status(400).json({ error: 'No se pudo identificar a los jugadores a mover.' });
          return;
        }
        const locA = findMatch(playoff.rounds, matchIdA);
        const locB = findMatch(playoff.rounds, matchIdB);
        if (!locA || !locB) {
          res.status(400).json({ error: 'No se pudo identificar a los jugadores a mover.' });
          return;
        }
        const mA = playoff.rounds[locA.ri][locA.mi];
        const mB = playoff.rounds[locB.ri][locB.mi];
        const tmp = mA[slotA];
        mA[slotA] = mB[slotB];
        mB[slotB] = tmp;
        if (locA.ri === 0 || locB.ri === 0) {
          playoff.rounds[0].forEach((m) => {
            if (m.p1 && !m.p2) m.winner = m.p1;
            else if (!m.p1 && m.p2) m.winner = m.p2;
            else if (m.p1 && m.p2 && m.winner && m.winner !== m.p1 && m.winner !== m.p2) m.winner = null;
          });
          propagate(playoff.rounds);
        }
        await savePlayoff(playoff);
        res.status(200).json({ id: DOC_ID, ...playoff });
        return;
      }

      res.status(400).json({ error: 'Acción no reconocida.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo actualizar el cuadro de playoffs.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const { error } = await supabase.from('playoff_bracket').delete().eq('id', DOC_ID);
      if (error) throw error;
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron reiniciar los playoffs.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
