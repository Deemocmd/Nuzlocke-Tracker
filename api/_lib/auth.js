import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signSession(payload) {
  // El token no expira rápido a propósito: el objetivo es que cualquier
  // dispositivo pueda entrar y quedarse "recordado" un buen tiempo.
  return jwt.sign(payload, SECRET, { expiresIn: '90d' });
}

export function readSession(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

export function requireAdmin(req, res) {
  const session = readSession(req);
  if (!session || session.role !== 'admin') {
    res.status(401).json({ error: 'Se requiere sesión de administrador.' });
    return null;
  }
  return session;
}

export function requireUserOrAdmin(req, res) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' });
    return null;
  }
  return session;
}

export function allowCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}
