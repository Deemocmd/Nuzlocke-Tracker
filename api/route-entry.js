import { db, COLLECTIONS } from './_lib/firebase.js';
import { requireUserOrAdmin, allowCors } from './_lib/auth.js';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'PUT') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const session = requireUserOrAdmin(req, res);
  if (!session) return;

  try {
    const { id } = req.query;
    if (!id) {
      res.status(400).json({ error: 'Falta el id de la fila de ruta.' });
      return;
    }

    const routeRef = db.collection(COLLECTIONS.routeEntries).doc(String(id));

    const result = await db.runTransaction(async (tx) => {
      // Firestore exige que todas las lecturas de una transacción ocurran
      // antes que cualquier escritura, así que primero resolvemos ambas
      // lecturas posibles (fila de ruta y, si aplica, el usuario dueño).
      const routeDoc = await tx.get(routeRef);
      if (!routeDoc.exists) {
        throw new Error('NOT_FOUND');
      }
      const existing = routeDoc.data();

      if (session.role !== 'admin' && session.userId !== existing.userId) {
        throw new Error('FORBIDDEN');
      }

      const { pokemonName, nickname, level, nature, status, ability, item, notes } = req.body || {};

      const newData = {
        pokemonName: pokemonName ?? null,
        nickname: nickname ?? '',
        level: level === '' || level === undefined ? null : Number(level),
        nature: nature ?? '',
        status: status ?? existing.status,
        ability: ability ?? '',
        item: item ?? '',
        notes: notes ?? '',
      };

      const oldStatus = existing.status;
      const newStatus = newData.status;
      const livesChange = oldStatus !== newStatus && (oldStatus === 'Muerto' || newStatus === 'Muerto');

      let userRef = null;
      let currentUser = null;
      if (livesChange) {
        userRef = db.collection(COLLECTIONS.users).doc(existing.userId);
        const userDoc = await tx.get(userRef);
        currentUser = userDoc.data();
      }

      // A partir de aquí, solo escrituras.
      tx.update(routeRef, newData);

      let user = null;
      if (livesChange && userRef) {
        let lives = currentUser.lives;
        if (newStatus === 'Muerto' && oldStatus !== 'Muerto') lives = Math.max(0, lives - 1);
        else if (oldStatus === 'Muerto' && newStatus !== 'Muerto') lives = Math.min(30, lives + 1);
        tx.update(userRef, { lives });
        user = { id: userRef.id, ...currentUser, lives };
      }

      return { updated: { id: routeRef.id, ...existing, ...newData }, user };
    });

    res.status(200).json(result);
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'Fila de ruta no encontrada.' });
      return;
    }
    if (err.message === 'FORBIDDEN') {
      res.status(403).json({ error: 'No puedes editar la ficha de otro participante.' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar la ficha.' });
  }
}
