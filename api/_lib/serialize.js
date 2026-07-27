// Postgres/Supabase devuelve columnas en snake_case y ya serializa los
// timestamptz como texto ISO 8601, así que a diferencia de la versión con
// Firestore (que guardaba Timestamp y requería un toIso manual) aquí solo
// hace falta remapear los nombres de campo.

export function serializeRoute(r) {
  return {
    id: r.id,
    userId: r.user_id,
    orderIndex: r.order_index,
    route: r.route,
    pokemonName: r.pokemon_name,
    nickname: r.nickname,
    level: r.level,
    nature: r.nature,
    status: r.status,
    ability: r.ability,
    item: r.item,
    notes: r.notes,
    isCustom: r.is_custom,
  };
}

export function serializeUser(u, routes = []) {
  return {
    id: u.id,
    name: u.name,
    color: u.color,
    lives: u.lives,
    wins: u.wins,
    losses: u.losses,
    status: u.status,
    createdAt: u.created_at,
    routes,
  };
}

export function serializeNews(n) {
  return {
    id: n.id,
    title: n.title,
    excerpt: n.excerpt,
    createdAt: n.created_at,
  };
}

export function serializeTrade(t) {
  return {
    id: t.id,
    userId: t.user_id,
    routeEntryId: t.route_entry_id,
    pokemonName: t.pokemon_name,
    routeName: t.route_name,
    receivedPokemon: t.received_pokemon,
    matchedWith: t.matched_with,
    status: t.status,
    createdAt: t.created_at,
    resolvedAt: t.resolved_at,
  };
}
