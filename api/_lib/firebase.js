import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// En entornos serverless (Vercel) cada invocación puede reutilizar el mismo
// contenedor; usamos getApps() para no inicializar la app de Firebase más
// de una vez por contenedor "caliente".

function buildCredential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // La clave privada llega desde el panel de Vercel con "\n" escapados
  // literalmente; hay que convertirlos en saltos de línea reales.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Faltan variables de entorno de Firebase (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).'
    );
  }

  return cert({ projectId, clientEmail, privateKey });
}

const app = getApps().length ? getApps()[0] : initializeApp({ credential: buildCredential() });

export const db = getFirestore(app);

// Nombres de las colecciones de Firestore (equivalentes a las tablas de Prisma).
export const COLLECTIONS = {
  users: 'users',
  routeEntries: 'routeEntries',
  news: 'newsPosts',
};
