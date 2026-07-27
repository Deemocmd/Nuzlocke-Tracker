import { supabase, TABLES } from './_lib/supabase.js';
import { requireAdmin, allowCors } from './_lib/auth.js';
import { randomUUID } from 'crypto';

// --------------------------------------------------------------------------
// Bracket suizo ("Torneo Oficial"): nuevo y separado del Bracket/Playoffs de
// eliminación directa que ya existía. Se guarda como una única fila
// (id: "main") en la tabla swiss_bracket, con todo su contenido en la
// columna jsonb "data". Solo el administrador puede crearlo, tocar
// resultados o mover participantes entre combates; el resto de la gente
// solo lo puede ver.
// --------------------------------------------------------------------------

const DOC_ID = 'main';

async function loadBracket() {
  const { data, error } = await supabase
    .from(TABLES.swissBracket)
    .select('data')
    .eq('id', DOC_ID)
    .maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}

async function saveBracket(bracket) {
  const { error } = await supabase.from(TABLES.swissBracket).upsert({ id: DOC_ID, data: bracket });
  if (error) throw error;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pairUp(ids, label) {
  const matches = [];
  for (let i = 0; i < ids.length; i += 2) {
    const playerA = ids[i];
    const playerB = ids[i + 1] ?? null;
    matches.push({
      id: randomUUID(),
      playerA,
      playerB,
      winner: playerB === null ? playerA : null, // BYE gana solo
      isBye: playerB === null,
    });
  }
  return { label, matches };
}

// Calcula récord (victorias/derrotas) de cada participante a partir de
// todas las rondas ya jugadas.
function computeRecords(bracket) {
  const records = {};
  bracket.participantIds.forEach((id) => { records[id] = { wins: 0, losses: 0 }; });
  bracket.rounds.forEach((round) => {
    round.matches.forEach((m) => {
      if (!m.winner) return;
      const loser = m.winner === m.playerA ? m.playerB : m.playerA;
      if (records[m.winner]) records[m.winner].wins += 1;
      if (loser && records[loser]) records[loser].losses += 1;
    });
  });
  return records;
}

function findMatch(bracket, matchId) {
  for (let ri = 0; ri < bracket.rounds.length; ri++) {
    const mi = bracket.rounds[ri].matches.findIndex((m) => m.id === matchId);
    if (mi !== -1) return { roundIndex: ri, matchIndex: mi };
  }
  return null;
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method === 'GET') {
    try {
      const bracket = await loadBracket();
      res.status(200).json(bracket ? { id: DOC_ID, ...bracket } : null);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cargar el torneo.' });
    }
    return;
  }

  // Todo lo que sigue (crear, editar resultados, mover jugadores, avanzar
  // de fecha, reiniciar) es exclusivo del administrador.
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
      const shuffled = shuffle(ids);
      const round1 = pairUp(shuffled, 'Fecha 1');
      const bracket = {
        title: String(title || 'Torneo Oficial').trim() || 'Torneo Oficial',
        status: 'active',
        participantIds: ids,
        rounds: [round1],
      };
      await saveBracket(bracket);
      res.status(201).json({ id: DOC_ID, ...bracket });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo crear el torneo.' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const bracket = await loadBracket();
      if (!bracket) {
        res.status(404).json({ error: 'Todavía no hay un torneo creado.' });
        return;
      }
      const { action } = req.body || {};

      if (action === 'setWinner') {
        const { matchId, winnerId } = req.body;
        const loc = findMatch(bracket, matchId);
        if (!loc) { res.status(404).json({ error: 'Combate no encontrado.' }); return; }
        const match = bracket.rounds[loc.roundIndex].matches[loc.matchIndex];
        if (winnerId !== null && winnerId !== match.playerA && winnerId !== match.playerB) {
          res.status(400).json({ error: 'Ese jugador no está en este combate.' });
          return;
        }
        match.winner = winnerId;
        await saveBracket(bracket);
        res.status(200).json({ id: DOC_ID, ...bracket });
        return;
      }

      if (action === 'swap') {
        const { matchIdA, slotA, matchIdB, slotB } = req.body;
        const locA = findMatch(bracket, matchIdA);
        const locB = findMatch(bracket, matchIdB);
        if (!locA || !locB || !['playerA', 'playerB'].includes(slotA) || !['playerA', 'playerB'].includes(slotB)) {
          res.status(400).json({ error: 'No se pudo identificar a los jugadores a mover.' });
          return;
        }
        const mA = bracket.rounds[locA.roundIndex].matches[locA.matchIndex];
        const mB = bracket.rounds[locB.roundIndex].matches[locB.matchIndex];
        const tmp = mA[slotA];
        mA[slotA] = mB[slotB];
        mB[slotB] = tmp;
        // Si el combate ya no puede tener BYE porque ahora tiene dos
        // jugadores (o dejó de tener alguno), recalculamos esa marca.
        [mA, mB].forEach((m) => {
          m.isBye = !m.playerA || !m.playerB;
          if (m.isBye) m.winner = m.playerA || m.playerB || null;
        });
        await saveBracket(bracket);
        res.status(200).json({ id: DOC_ID, ...bracket });
        return;
      }

      if (action === 'advanceRound') {
        const currentRound = bracket.rounds[bracket.rounds.length - 1];
        const missing = currentRound.matches.some((m) => !m.isBye && !m.winner);
        if (missing) {
          res.status(400).json({ error: 'Todavía faltan resultados por cargar en la fecha actual.' });
          return;
        }
        const records = computeRecords(bracket);
        const groups = new Map();
        bracket.participantIds.forEach((id) => {
          const key = `${records[id].wins}-${records[id].losses}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(id);
        });
        // Ordenamos los grupos de mejor a peor récord (más victorias primero).
        const orderedGroups = [...groups.entries()].sort((a, b) => {
          const [wa, la] = a[0].split('-').map(Number);
          const [wb, lb] = b[0].split('-').map(Number);
          if (wa !== wb) return wb - wa;
          return la - lb;
        });

        const leftovers = [];
        const matches = [];
        orderedGroups.forEach(([, ids]) => {
          for (let i = 0; i < ids.length - 1; i += 2) {
            matches.push({ id: randomUUID(), playerA: ids[i], playerB: ids[i + 1], winner: null, isBye: false });
          }
          if (ids.length % 2 === 1) leftovers.push(ids[ids.length - 1]);
        });
        for (let i = 0; i < leftovers.length; i += 2) {
          const playerA = leftovers[i];
          const playerB = leftovers[i + 1] ?? null;
          matches.push({
            id: randomUUID(),
            playerA,
            playerB,
            winner: playerB === null ? playerA : null,
            isBye: playerB === null,
          });
        }

        bracket.rounds.push({ label: `Fecha ${bracket.rounds.length + 1}`, matches });
        await saveBracket(bracket);
        res.status(200).json({ id: DOC_ID, ...bracket });
        return;
      }

      if (action === 'finish') {
        bracket.status = 'finished';
        await saveBracket(bracket);
        res.status(200).json({ id: DOC_ID, ...bracket });
        return;
      }

      res.status(400).json({ error: 'Acción no reconocida.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo actualizar el torneo.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const { error } = await supabase.from(TABLES.swissBracket).delete().eq('id', DOC_ID);
      if (error) throw error;
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo reiniciar el torneo.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
