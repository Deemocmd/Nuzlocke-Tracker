import { db, COLLECTIONS } from './_lib/firebase.js';
import { requireAdmin, allowCors } from './_lib/auth.js';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method === 'GET') {
    try {
      const snap = await db.collection(COLLECTIONS.news).orderBy('createdAt', 'desc').limit(20).get();
      const news = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.status(200).json(news);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron cargar las noticias.' });
    }
    return;
  }

  if (req.method === 'POST') {
    const session = requireAdmin(req, res);
    if (!session) return;
    try {
      const { title } = req.body || {};
      const trimmed = String(title || '').trim();
      if (!trimmed) {
        res.status(400).json({ error: 'Escribe un título.' });
        return;
      }
      const ref = db.collection(COLLECTIONS.news).doc();
      await ref.set({
        title: trimmed,
        excerpt: 'Publicada desde el panel de administrador.',
        createdAt: FieldValue.serverTimestamp(),
      });
      const created = await ref.get();
      res.status(201).json({ id: ref.id, ...created.data() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo publicar la noticia.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
