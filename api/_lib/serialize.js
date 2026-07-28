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

export function wonderTradeToJson(row) {
  return {
    id: row.id,
    userId: row.user_id,
    routeEntryId: row.route_entry_id,
    pokemonName: row.pokemon_name,
    routeName: row.route_name,
    receivedPokemon: row.received_pokemon,
    matchedWith: row.matched_with,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export function directTradeToJson(row, extra = {}) {
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    fromRouteEntryId: row.from_route_entry_id,
    offeredPokemon: row.offered_pokemon,
    offeredRouteName: row.offered_route_name,
    requestedPokemon: row.requested_pokemon,
    status: row.status,
    toUserId: row.to_user_id,
    toRouteEntryId: row.to_route_entry_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    ...extra,
  };
}
