// Cliente ligero para hablar con las funciones serverless de /api, que a su
// vez usan Firebase Admin para leer/escribir en Firestore. Todo lo que antes
// vivía solo en memoria (usuarios, rutas, noticias) ahora se guarda en la
// base de datos, así que cualquier persona desde cualquier dispositivo ve lo
// mismo.

const SESSION_KEY = 'nuzlocke_session';

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const session = loadSession();
    if (session && session.token) headers.Authorization = `Bearer ${session.token}`;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* respuesta vacía */ }
  if (!res.ok) {
    throw new Error(data.error || `Error de red (${res.status})`);
  }
  return data;
}

export const api = {
  loginAdmin: (password) => request('/login', { method: 'POST', body: { role: 'admin', password } }),
  loginUser: (userId, password) => request('/login', { method: 'POST', body: { role: 'user', userId, password } }),
  getUsers: () => request('/users'),
  createUser: (name, password) => request('/users', { method: 'POST', body: { name, password }, auth: true }),
  deleteUser: (id) => request(`/users?id=${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }),
  updateRoute: (id, data) => request(`/route-entry?id=${encodeURIComponent(id)}`, { method: 'PUT', body: data, auth: true }),
  getNews: () => request('/news'),
  addNews: (title) => request('/news', { method: 'POST', body: { title }, auth: true }),

  addCustomRoute: (route) => request('/custom-route', { method: 'POST', body: { route }, auth: true }),
  deleteCustomRoute: (id) => request(`/custom-route?id=${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }),

  getBracket: () => request('/bracket'),
  createBracket: (title, participantIds) => request('/bracket', { method: 'POST', body: { title, participantIds }, auth: true }),
  bracketSetWinner: (matchId, winnerId) => request('/bracket', { method: 'PUT', body: { action: 'setWinner', matchId, winnerId }, auth: true }),
  bracketSwap: (matchIdA, slotA, matchIdB, slotB) => request('/bracket', { method: 'PUT', body: { action: 'swap', matchIdA, slotA, matchIdB, slotB }, auth: true }),
  bracketAdvanceRound: () => request('/bracket', { method: 'PUT', body: { action: 'advanceRound' }, auth: true }),
  bracketFinish: () => request('/bracket', { method: 'PUT', body: { action: 'finish' }, auth: true }),
  resetBracket: () => request('/bracket', { method: 'DELETE', auth: true }),

  getPlayoff: () => request('/playoff'),
  generatePlayoff: (size) => request('/playoff', { method: 'POST', body: { size }, auth: true }),
  playoffSetWinner: (matchId, winnerId) => request('/playoff', { method: 'PUT', body: { action: 'setWinner', matchId, winnerId }, auth: true }),
  resetPlayoff: () => request('/playoff', { method: 'DELETE', auth: true }),
};

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
