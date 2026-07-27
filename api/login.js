import bcrypt from 'bcryptjs';
import { db, COLLECTIONS } from './_lib/firebase.js';
import { signSession, allowCors } from './_lib/auth.js';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  try {
    const { role, userId, password } = req.body || {};

    if (role === 'admin') {
      const adminPassword = process.env.ADMIN_PASSWORD || 'nuzlocke-admin';
      if (password !== adminPassword) {
        res.status(401).json({ error: 'Contraseña de administrador incorrecta.' });
        return;
      }
      const token = signSession({ role: 'admin' });
      res.status(200).json({ token, role: 'admin' });
      return;
    }

    if (role === 'user') {
      if (!userId || !password) {
        res.status(400).json({ error: 'Faltan datos de inicio de sesión.' });
        return;
      }
      const doc = await db.collection(COLLECTIONS.users).doc(String(userId)).get();
      if (!doc.exists) {
        res.status(401).json({ error: 'Usuario no encontrado.' });
        return;
      }
      const user = doc.data();
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        res.status(401).json({ error: 'Contraseña incorrecta.' });
        return;
      }
      const token = signSession({ role: 'user', userId: doc.id });
      res.status(200).json({ token, role: 'user', userId: doc.id, name: user.name });
      return;
    }

    res.status(400).json({ error: 'Rol de sesión no válido.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno al iniciar sesión.' });
  }
}
