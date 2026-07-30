import { supabase } from './_lib/supabase.js';
import { requireAdmin, allowCors } from './_lib/auth.js';
import { randomUUID } from 'crypto';

// --------------------------------------------------------------------------
// Playoffs (eliminación directa a partido único). Se generan a partir de la
// clasificación final del Torneo Oficial (bracket suizo): mejor récord
// primero, desempatando por vidas restantes. Se guarda como una única fila
// ("main") en la tabla playoff_bracket, igual que el bracket suizo.
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
  return { status: data.status, participants: data.participants, rounds: data.rounds };
}

async function savePlayoff(p) {
  const { error } = await supabase.from('playoff_bracket').upsert({
    id: DOC_ID,
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
      const { data: swiss, error: swissErr } = await supabase.from('swiss_bracket').select('*').eq('id', 'main').maybeSingle();
      if (swissErr) throw swissErr;
      if (!swiss) {
        res.status(400).json({ error: 'Todavía no hay un Torneo Oficial creado.' });
        return;
      }
      if (swiss.status !== 'finished') {
        res.status(400).json({ error: 'El Torneo Oficial todavía no está finalizado.' });
        return;
      }

      // Récord de cada participante a partir de todas las fechas jugadas.
      const records = {};
      (swiss.participant_ids || []).forEach((id) => { records[id] = { wins: 0, losses: 0 }; });
      (swiss.rounds || []).forEach((round) => {
        round.matches.forEach((m) => {
          if (!m.winner) return;
          const loser = m.winner === m.playerA ? m.playerB : m.playerA;
          if (records[m.winner]) records[m.winner].wins += 1;
          if (loser && records[loser]) records[loser].losses += 1;
        });
      });

      const { data: users, error: usersErr } = await supabase
        .from('users').select('id, name, color, lives').in('id', swiss.participant_ids || []);
      if (usersErr) throw usersErr;
      const userMap = {};
      users.forEach((u) => { userMap[u.id] = u; });

      // Clasificación final: más victorias primero, luego menos derrotas,
      // y como último desempate, más vidas restantes.
      const standings = [...(swiss.participant_ids || [])]
        .filter((id) => userMap[id])
        .sort((a, b) => {
          const ra = records[a] || { wins: 0, losses: 0 };
          const rb = records[b] || { wins: 0, losses: 0 };
          if (ra.wins !== rb.wins) return rb.wins - ra.wins;
          if (ra.losses !== rb.losses) return ra.losses - rb.losses;
          return (userMap[b].lives || 0) - (userMap[a].lives || 0);
        });

      if (standings.length < 2) {
        res.status(400).json({ error: 'Hacen falta al menos 2 participantes con récord para armar los playoffs.' });
        return;
      }

      const { size } = req.body || {};
      const requested = Number(size) || nextPowerOfTwo(Math.min(standings.length, MAX_SIZE));
      const bracketSize = Math.max(2, Math.min(MAX_SIZE, nextPowerOfTwo(requested)));
      const seeded = standings.slice(0, bracketSize);

      const participants = seeded.map((id) => ({
        id,
        name: userMap[id].name,
        color: userMap[id].color,
      }));

      const rounds = buildRounds(seeded, bracketSize);
      const playoff = { status: 'active', participants, rounds };
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
