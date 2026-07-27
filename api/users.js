import bcrypt from 'bcryptjs';
import { db, COLLECTIONS } from './_lib/firebase.js';
import { requireAdmin, allowCors } from './_lib/auth.js';
import { HOENN_LOCATIONS, USER_COLOR_POOL } from '../shared/constants.js';
import { FieldValue } from 'firebase-admin/firestore';

// Firestore guarda las fechas como objetos Timestamp, no como texto; los
// convertimos a ISO string antes de responder para que el frontend pueda
// usarlas directamente con `new Date(...)`.
function toIso(value) {
  return value && value.toDate ? value.toDate().toISOString() : value;
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method === 'GET') {
    try {
      const usersSnap = await db.collection(COLLECTIONS.users).orderBy('createdAt', 'asc').get();

      const users = await Promise.all(
        usersSnap.docs.map(async (doc) => {
          const routesSnap = await db
            .collection(COLLECTIONS.routeEntries)
            .where('userId', '==', doc.id)
            .orderBy('orderIndex', 'asc')
            .get();
          const routes = routesSnap.docs.map((r) => ({ id: r.id, ...r.data() }));
          // Nunca devolvemos la contraseña al cliente.
          const { password, createdAt, ...rest } = doc.data();
          return { id: doc.id, ...rest, createdAt: toIso(createdAt), routes };
        })
      );

      res.status(200).json(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron cargar los participantes.' });
    }
    return;
  }

  if (req.method === 'POST') {
    const session = requireAdmin(req, res);
    if (!session) return;

    try {
      const { name, password } = req.body || {};
      const trimmedName = String(name || '').trim();
      if (!trimmedName || !password) {
        res.status(400).json({ error: 'Escribe un nombre y una contraseña.' });
        return;
      }

      const existingSnap = await db
        .collection(COLLECTIONS.users)
        .where('name', '==', trimmedName)
        .limit(1)
        .get();
      if (!existingSnap.empty) {
        res.status(409).json({ error: 'Ya existe un participante con ese nombre.' });
        return;
      }

      const countSnap = await db.collection(COLLECTIONS.users).count().get();
      const count = countSnap.data().count;
      const color = USER_COLOR_POOL[count % USER_COLOR_POOL.length];
      const hashed = await bcrypt.hash(String(password), 10);

      const userRef = db.collection(COLLECTIONS.users).doc();
      const batch = db.batch();
      batch.set(userRef, {
        name: trimmedName,
        password: hashed,
        color,
        lives: 30,
        wins: 0,
        losses: 0,
        status: 'Activo',
        createdAt: FieldValue.serverTimestamp(),
      });

      const routes = HOENN_LOCATIONS.map((route, i) => {
        const routeRef = db.collection(COLLECTIONS.routeEntries).doc();
        const data = {
          userId: userRef.id,
          orderIndex: i + 1,
          route,
          pokemonName: null,
          nickname: '',
          level: null,
          nature: '',
          status: 'Vivo',
          ability: '',
          item: '',
          notes: '',
        };
        batch.set(routeRef, data);
        return { id: routeRef.id, ...data };
      });

      await batch.commit();

      const created = await userRef.get();
      const { password: _pw, createdAt, ...safe } = created.data();
      res.status(201).json({ id: userRef.id, ...safe, createdAt: toIso(createdAt), routes });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo crear el participante.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    const session = requireAdmin(req, res);
    if (!session) return;
    try {
      const { id } = req.query;
      if (!id) {
        res.status(400).json({ error: 'Falta el id del participante.' });
        return;
      }

      const routesSnap = await db
        .collection(COLLECTIONS.routeEntries)
        .where('userId', '==', String(id))
        .get();

      const batch = db.batch();
      routesSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(db.collection(COLLECTIONS.users).doc(String(id)));
      await batch.commit();

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo eliminar el participante.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
