// Postgres/Supabase devuelve columnas en snake_case; el frontend (src/App.jsx)
// espera el mismo shape camelCase que antes devolvía Firestore. Estos
// helpers hacen esa conversión en un solo lugar.

export function userToJson(row, routes = []) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    lives: row.lives,
    wins: row.wins,
    losses: row.losses,
    status: row.status,
    createdAt: row.created_at,
    routes,
  };
}

export function routeToJson(row) {
  return {
    id: row.id,
    userId: row.user_id,
    orderIndex: row.order_index,
    route: row.route,
    pokemonName: row.pokemon_name,
    nickname: row.nickname,
    level: row.level,
    nature: row.nature,
    status: row.status,
    ability: row.ability,
    item: row.item,
    notes: row.notes,
    isCustom: row.is_custom,
  };
}

export function newsToJson(row) {
  return { id: row.id, title: row.title, excerpt: row.excerpt, createdAt: row.created_at };
}

