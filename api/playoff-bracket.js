import { supabase } from './_lib/supabase.js';
import { requireAdmin, allowCors } from './_lib/auth.js';
import { randomUUID } from 'crypto';

// --------------------------------------------------------------------------
// Playoffs (cuadro de 32, eliminación directa): una única fila "main" en
// playoff_bracket. Solo el administrador puede crearlo, asignar rivales en
// la primera ronda o marcar ganadores; el resto solo lo ve.
// --------------------------------------------------------------------------

const DOC_ID = 'main';
const ROUND_SIZES = [16, 8, 4, 2, 1];

function buildEmptyRounds() {
  return ROUND_SIZES.map((size) =>
    Array.from({ length: size }, () => ({
      id: randomUUID(),
      p1Id: null,
      p2Id: null,
      winnerId: null,
    })),
  );
}

function autoByeWinner(match) {
  const { p1Id, p2Id } = match;
  if (p1Id && !p2Id) return p1Id;
  if (!p1Id && p2Id) return p2Id;
  return null;
}

function validateFirstRound(matches, participantIds = null) {
  if (!Array.isArray(matches)) {
    return { ok: false, error: 'Emparejamientos no válidos.' };
  }
  const allowed = participantIds ? new Set(participantIds) : null;
  const seen = new Set();

  for (let i = 0; i < matches.length; i++) {
    const p1Id = matches[i]?.p1Id ?? null;
    const p2Id = matches[i]?.p2Id ?? null;

    if (p1Id && p2Id && p1Id === p2Id) {
      return { ok: false, error: `El combate ${i + 1} no puede enfrentar al mismo jugador consigo mismo.` };
    }

    for (const id of [p1Id, p2Id]) {
      if (!id) continue;
      if (allowed && !allowed.has(id)) {
        return { ok: false, error: 'Hay un jugador que no está en la lista de participantes.' };
      }
      if (seen.has(id)) {
        return { ok: false, error: 'Un jugador no puede aparecer en más de un combate de dieciseisavos.' };
      }
      seen.add(id);
    }
  }

  return { ok: true };
}

function firstRoundFromRound0(round0) {
  return round0.map((m) => ({ p1Id: m.p1Id ?? null, p2Id: m.p2Id ?? null }));
}

function propagateWinners(inputRounds) {
  const rounds = inputRounds.map((r) => r.map((m) => ({ ...m })));

  for (let r = 0; r < rounds.length - 1; r++) {
    rounds[r].forEach((m, i) => {
      const targetIndex = Math.floor(i / 2);
      const slot = i % 2 === 0 ? 'p1Id' : 'p2Id';
      rounds[r + 1][targetIndex][slot] = m.winnerId || null;
    });

    rounds[r + 1].forEach((m) => {
      if (m.winnerId && m.winnerId !== m.p1Id && m.winnerId !== m.p2Id) {
        m.winnerId = null;
      }
      if (!m.winnerId) {
        m.winnerId = autoByeWinner(m);
      }
    });
  }

  return rounds;
}

function fillFirstRound(rounds, participantIds, firstRound) {
  const round0 = rounds[0];

  if (Array.isArray(firstRound) && firstRound.length === 16) {
    firstRound.forEach((pair, i) => {
      round0[i].p1Id = pair?.p1Id ?? null;
      round0[i].p2Id = pair?.p2Id ?? null;
      round0[i].winnerId = autoByeWinner(round0[i]);
    });
    return propagateWinners(rounds);
  }

  const slots = [...participantIds];
  while (slots.length < 32) slots.push(null);

  for (let i = 0; i < 16; i++) {
    round0[i].p1Id = slots[i * 2] ?? null;
    round0[i].p2Id = slots[i * 2 + 1] ?? null;
    round0[i].winnerId = autoByeWinner(round0[i]);
  }

  return propagateWinners(rounds);
}

function findMatch(bracket, matchId) {
  for (let ri = 0; ri < bracket.rounds.length; ri++) {
    const mi = bracket.rounds[ri].findIndex((m) => m.id === matchId);
    if (mi !== -1) return { roundIndex: ri, matchIndex: mi };
  }
  return null;
}

async function loadBracket() {
  const { data, error } = await supabase.from('playoff_bracket').select('*').eq('id', DOC_ID).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    title: data.title,
    status: data.status,
    participantIds: data.participant_ids,
    rounds: data.rounds,
  };
}

async function saveBracket(bracket) {
  const { error } = await supabase.from('playoff_bracket').upsert({
    id: DOC_ID,
    title: bracket.title,
    status: bracket.status,
    participant_ids: bracket.participantIds,
    rounds: bracket.rounds,
  });
  if (error) throw error;
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method === 'GET') {
    try {
      const bracket = await loadBracket();
      res.status(200).json(bracket ? { id: DOC_ID, ...bracket } : null);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cargar el cuadro de playoffs.' });
    }
    return;
  }

  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'POST') {
    try {
      const { title, participantIds, firstRound } = req.body || {};
      const ids = Array.isArray(participantIds) ? participantIds.filter(Boolean) : [];
      if (ids.length < 1) {
        res.status(400).json({ error: 'Selecciona al menos 1 participante.' });
        return;
      }
      if (ids.length > 32) {
        res.status(400).json({ error: 'Máximo 32 participantes en el cuadro.' });
        return;
      }

      if (Array.isArray(firstRound) && firstRound.length === 16) {
        const check = validateFirstRound(firstRound, ids);
        if (!check.ok) {
          res.status(400).json({ error: check.error });
          return;
        }
      }

      const rounds = fillFirstRound(buildEmptyRounds(), ids, firstRound);
      const bracket = {
        title: String(title || 'Playoffs').trim() || 'Playoffs',
        status: 'active',
        participantIds: ids,
        rounds,
      };
      await saveBracket(bracket);
      res.status(201).json({ id: DOC_ID, ...bracket });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo crear el cuadro de playoffs.' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const bracket = await loadBracket();
      if (!bracket) {
        res.status(404).json({ error: 'Todavía no hay un cuadro de playoffs creado.' });
        return;
      }
      const { action } = req.body || {};

      if (action === 'setWinner') {
        const { matchId, winnerId } = req.body;
        const loc = findMatch(bracket, matchId);
        if (!loc) { res.status(404).json({ error: 'Combate no encontrado.' }); return; }
        const match = bracket.rounds[loc.roundIndex][loc.matchIndex];
        if (winnerId !== null && winnerId !== match.p1Id && winnerId !== match.p2Id) {
          res.status(400).json({ error: 'Ese jugador no está en este combate.' });
          return;
        }
        match.winnerId = winnerId;
        bracket.rounds = propagateWinners(bracket.rounds);
        await saveBracket(bracket);
        res.status(200).json({ id: DOC_ID, ...bracket });
        return;
      }

      if (action === 'setOpponent') {
        const { matchIndex, slot, playerId } = req.body;
        if (bracket.status !== 'active') {
          res.status(400).json({ error: 'El cuadro ya está finalizado.' });
          return;
        }
        if (typeof matchIndex !== 'number' || matchIndex < 0 || matchIndex > 15) {
          res.status(400).json({ error: 'Combate de primera ronda no válido.' });
          return;
        }
        if (!['p1', 'p2'].includes(slot)) {
          res.status(400).json({ error: 'Casillero no válido.' });
          return;
        }
        if (playerId && !(bracket.participantIds || []).includes(playerId)) {
          res.status(400).json({ error: 'Ese jugador no está en el cuadro.' });
          return;
        }
        const match = bracket.rounds[0][matchIndex];
        const key = slot === 'p1' ? 'p1Id' : 'p2Id';
        const draft = firstRoundFromRound0(bracket.rounds[0]);
        draft[matchIndex] = { ...draft[matchIndex], [key]: playerId || null };
        const check = validateFirstRound(draft, bracket.participantIds);
        if (!check.ok) {
          res.status(400).json({ error: check.error });
          return;
        }
        match[key] = playerId || null;
        match.winnerId = autoByeWinner(match);
        bracket.rounds = propagateWinners(bracket.rounds);
        await saveBracket(bracket);
        res.status(200).json({ id: DOC_ID, ...bracket });
        return;
      }

      if (action === 'setFirstRound') {
        const { matches } = req.body;
        if (bracket.status !== 'active') {
          res.status(400).json({ error: 'El cuadro ya está finalizado.' });
          return;
        }
        if (!Array.isArray(matches) || matches.length !== 16) {
          res.status(400).json({ error: 'Se requieren exactamente 16 emparejamientos.' });
          return;
        }
        const check = validateFirstRound(matches, bracket.participantIds);
        if (!check.ok) {
          res.status(400).json({ error: check.error });
          return;
        }
        matches.forEach((pair, i) => {
          const match = bracket.rounds[0][i];
          match.p1Id = pair?.p1Id ?? null;
          match.p2Id = pair?.p2Id ?? null;
          match.winnerId = autoByeWinner(match);
        });
        bracket.rounds = propagateWinners(bracket.rounds);
        await saveBracket(bracket);
        res.status(200).json({ id: DOC_ID, ...bracket });
        return;
      }

      if (action === 'swap') {
        const { matchIndexA, slotA, matchIndexB, slotB } = req.body;
        if (bracket.status !== 'active') {
          res.status(400).json({ error: 'El cuadro ya está finalizado.' });
          return;
        }
        if (!['p1', 'p2'].includes(slotA) || !['p1', 'p2'].includes(slotB)) {
          res.status(400).json({ error: 'Casillero no válido.' });
          return;
        }
        const keyA = slotA === 'p1' ? 'p1Id' : 'p2Id';
        const keyB = slotB === 'p1' ? 'p1Id' : 'p2Id';
        const mA = bracket.rounds[0][matchIndexA];
        const mB = bracket.rounds[0][matchIndexB];
        if (!mA || !mB) {
          res.status(400).json({ error: 'Combate no encontrado.' });
          return;
        }
        const tmp = mA[keyA];
        mA[keyA] = mB[keyB];
        mB[keyB] = tmp;
        const check = validateFirstRound(firstRoundFromRound0(bracket.rounds[0]), bracket.participantIds);
        if (!check.ok) {
          mB[keyB] = mA[keyA];
          mA[keyA] = tmp;
          res.status(400).json({ error: check.error });
          return;
        }
        [mA, mB].forEach((m) => {
          m.winnerId = autoByeWinner(m);
        });
        bracket.rounds = propagateWinners(bracket.rounds);
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
      res.status(500).json({ error: 'No se pudo reiniciar el cuadro de playoffs.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
