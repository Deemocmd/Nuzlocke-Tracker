import { db, COLLECTIONS } from './_lib/firebase.js';
import { requireUserOrAdmin, allowCors } from './_lib/auth.js';

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

      const existingSnap = await db
        .collection(COLLECTIONS.routeEntries)
        .where('userId', '==', session.userId)
        .get();
      const maxIndex = existingSnap.docs.reduce((max, d) => Math.max(max, d.data().orderIndex || 0), 0);
      const nextIndex = maxIndex + 1;

      const ref = db.collection(COLLECTIONS.routeEntries).doc();
      const data = {
        userId: session.userId,
        orderIndex: nextIndex,
        route: trimmed,
        pokemonName: null,
        nickname: '',
        level: null,
        nature: '',
        status: 'Vivo',
        ability: '',
        item: '',
        notes: '',
        isCustom: true,
      };
      await ref.set(data);
      res.status(201).json({ id: ref.id, ...data });
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
      const ref = db.collection(COLLECTIONS.routeEntries).doc(String(id));
      const doc = await ref.get();
      if (!doc.exists || doc.data().userId !== session.userId) {
        res.status(404).json({ error: 'Esa fila no existe o no te pertenece.' });
        return;
      }
      if (!doc.data().isCustom) {
        res.status(403).json({ error: 'Solo puedes eliminar filas que hayas agregado tú mismo.' });
        return;
      }
      await ref.delete();
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo eliminar la fila.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
