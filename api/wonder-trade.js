import { db, COLLECTIONS } from './_lib/firebase.js';
import { requireUserOrAdmin, allowCors } from './_lib/auth.js';
import { FieldValue } from 'firebase-admin/firestore';

// --------------------------------------------------------------------------
// Intercambios prodigiosos (Wonder Trade)
//
// Cualquier participante puede ofrecer uno de sus Pokémon vivos. Si en ese
// momento ya hay otra oferta pendiente de OTRO participante, se emparejan al
// instante y cada uno recibe el Pokémon del otro en la misma fila de ruta
// que ofreció. Si no hay nadie esperando, su oferta queda "en cola" hasta
// que otro participante mande la suya.
// --------------------------------------------------------------------------

function toIso(value) {
  return value && value.toDate ? value.toDate().toISOString() : value;
}

function serializeTrade(id, data) {
  return { id, ...data, createdAt: toIso(data.createdAt), resolvedAt: toIso(data.resolvedAt) };
}

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
      const pendingSnap = await db
        .collection(COLLECTIONS.wonderTrades)
        .where('userId', '==', session.userId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();
      const pending = pendingSnap.empty ? null : serializeTrade(pendingSnap.docs[0].id, pendingSnap.docs[0].data());

      const historySnap = await db
        .collection(COLLECTIONS.wonderTrades)
        .where('userId', '==', session.userId)
        .where('status', '==', 'completed')
        .get();
      const history = historySnap.docs
        .map((d) => serializeTrade(d.id, d.data()))
        .sort((a, b) => new Date(b.resolvedAt || 0) - new Date(a.resolvedAt || 0))
        .slice(0, 20);

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

      const routeRef = db.collection(COLLECTIONS.routeEntries).doc(String(routeEntryId));
      const routeDoc = await routeRef.get();
      if (!routeDoc.exists || routeDoc.data().userId !== session.userId) {
        res.status(404).json({ error: 'Esa fila no te pertenece.' });
        return;
      }
      const routeData = routeDoc.data();
      if (routeData.status !== 'Vivo' || !routeData.pokemonName || !routeData.pokemonName.trim()) {
        res.status(400).json({ error: 'Solo puedes ofrecer un Pokémon vivo con especie asignada.' });
        return;
      }

      // Si ya tenías una oferta pendiente, la reemplazamos por esta.
      const existingMineSnap = await db
        .collection(COLLECTIONS.wonderTrades)
        .where('userId', '==', session.userId)
        .where('status', '==', 'pending')
        .get();
      const cleanupBatch = db.batch();
      existingMineSnap.docs.forEach((d) => cleanupBatch.delete(d.ref));
      if (!existingMineSnap.empty) await cleanupBatch.commit();

      // Buscamos una oferta pendiente de otro participante.
      const poolSnap = await db.collection(COLLECTIONS.wonderTrades).where('status', '==', 'pending').get();
      const candidates = poolSnap.docs.filter((d) => d.data().userId !== session.userId);

      const myOffer = {
        pokemonName: routeData.pokemonName,
        routeName: routeData.route,
      };

      if (candidates.length === 0) {
        // Nadie esperando: dejamos nuestra oferta en cola.
        const ref = db.collection(COLLECTIONS.wonderTrades).doc();
        await ref.set({
          userId: session.userId,
          routeEntryId: routeRef.id,
          pokemonName: myOffer.pokemonName,
          routeName: myOffer.routeName,
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
        });
        const created = await ref.get();
        res.status(201).json({ matched: false, pending: serializeTrade(ref.id, created.data()) });
        return;
      }

      // Emparejamos con una oferta al azar entre las disponibles.
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      const chosenData = chosen.data();
      const partnerRouteRef = db.collection(COLLECTIONS.routeEntries).doc(chosenData.routeEntryId);

      const result = await db.runTransaction(async (tx) => {
        const partnerRouteDoc = await tx.get(partnerRouteRef);
        if (!partnerRouteDoc.exists) throw new Error('PARTNER_GONE');
        const partnerData = partnerRouteDoc.data();

        // Escrituras: intercambiamos la especie entre ambas filas; el resto
        // de la ficha (apodo, nivel, naturaleza...) se reinicia porque ahora
        // es un individuo distinto.
        tx.update(routeRef, {
          pokemonName: partnerData.pokemonName,
          nickname: '',
          level: null,
          nature: '',
          ability: '',
          item: '',
          notes: '',
        });
        tx.update(partnerRouteRef, {
          pokemonName: routeData.pokemonName,
          nickname: '',
          level: null,
          nature: '',
          ability: '',
          item: '',
          notes: '',
        });

        const now = FieldValue.serverTimestamp();
        const myCompletedRef = db.collection(COLLECTIONS.wonderTrades).doc();
        tx.set(myCompletedRef, {
          userId: session.userId,
          routeEntryId: routeRef.id,
          pokemonName: myOffer.pokemonName,
          routeName: myOffer.routeName,
          receivedPokemon: partnerData.pokemonName,
          matchedWith: chosenData.userId,
          status: 'completed',
          createdAt: FieldValue.serverTimestamp(),
          resolvedAt: now,
        });
        tx.set(chosen.ref, {
          ...chosenData,
          receivedPokemon: myOffer.pokemonName,
          matchedWith: session.userId,
          status: 'completed',
          resolvedAt: now,
        });

        return { received: partnerData.pokemonName };
      });

      res.status(200).json({ matched: true, received: result.received, offered: myOffer.pokemonName });
    } catch (err) {
      if (err.message === 'PARTNER_GONE') {
        res.status(409).json({ error: 'Esa oferta ya no está disponible, inténtalo de nuevo.' });
        return;
      }
      console.error(err);
      res.status(500).json({ error: 'No se pudo procesar el intercambio.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const snap = await db
        .collection(COLLECTIONS.wonderTrades)
        .where('userId', '==', session.userId)
        .where('status', '==', 'pending')
        .get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cancelar la oferta.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
