-- ---------------------------------------------------------------------------
-- Nuzlocke Hub — esquema de Supabase (Postgres)
--
-- Reemplaza las colecciones de Firestore por tablas relacionales. Todo el
-- acceso a estas tablas pasa por las funciones serverless de /api usando la
-- Service Role Key (permisos totales, igual que hacía el Admin SDK con
-- Firestore), así que dejamos RLS activado pero SIN políticas: equivalente a
-- las reglas de Firestore que negaban todo acceso directo desde el cliente.
--
-- Cómo aplicar esta migración:
--   - Supabase Studio -> SQL Editor -> pegar y ejecutar este archivo, o
--   - CLI: `supabase db push` (con este archivo dentro de supabase/migrations)
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  password text not null, -- hash bcrypt
  color text not null,
  lives int not null default 30,
  wins int not null default 0,
  losses int not null default 0,
  status text not null default 'Activo',
  created_at timestamptz not null default now()
);

create table if not exists route_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  order_index int not null,
  route text not null,
  pokemon_name text,
  nickname text not null default '',
  level int,
  nature text not null default '',
  status text not null default 'Vivo',
  ability text not null default '',
  item text not null default '',
  notes text not null default '',
  is_custom boolean not null default false
);

create index if not exists route_entries_user_id_idx on route_entries(user_id);
create index if not exists route_entries_user_order_idx on route_entries(user_id, order_index);

create table if not exists news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  excerpt text,
  created_at timestamptz not null default now()
);

create table if not exists wonder_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  route_entry_id uuid not null references route_entries(id) on delete cascade,
  pokemon_name text,
  route_name text,
  received_pokemon text,
  matched_with uuid,
  status text not null default 'pending', -- 'pending' | 'completed'
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists wonder_trades_user_status_idx on wonder_trades(user_id, status);
create index if not exists wonder_trades_status_idx on wonder_trades(status);

-- Bracket suizo ("Torneo Oficial"): un único documento (fila con id 'main'),
-- igual que antes se guardaba un único doc en Firestore. Todo el contenido
-- variable (título, estado, participantes, rondas) vive en la columna jsonb
-- "data" para no tener que migrar el esquema cada vez que cambie su forma.
create table if not exists swiss_bracket (
  id text primary key,
  data jsonb not null
);

-- ---------------------------------------------------------------------------
-- RLS: cerrado a accesos externos (equivalente a las reglas de Firestore).
-- Las funciones serverless usan la Service Role Key, que siempre puede
-- saltarse RLS, así que no hace falta ninguna policy.
-- ---------------------------------------------------------------------------

alter table users enable row level security;
alter table route_entries enable row level security;
alter table news_posts enable row level security;
alter table wonder_trades enable row level security;
alter table swiss_bracket enable row level security;

-- ---------------------------------------------------------------------------
-- Funciones RPC transaccionales
--
-- Postgres ejecuta cada función en una única transacción implícita, así que
-- estas reemplazan los batch/runTransaction de Firestore sin necesidad de
-- manejar el commit manualmente desde JS.
-- ---------------------------------------------------------------------------

-- Crea un participante nuevo junto con sus filas de ruta iniciales (las 62
-- zonas fijas de Hoenn). p_routes es un jsonb array de {"orderIndex","route"}.
create or replace function create_participant(
  p_name text,
  p_password text,
  p_color text,
  p_routes jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_user users%rowtype;
  v_route_item jsonb;
  v_inserted route_entries%rowtype;
  v_routes jsonb := '[]'::jsonb;
begin
  insert into users (name, password, color, lives, wins, losses, status)
  values (p_name, p_password, p_color, 30, 0, 0, 'Activo')
  returning * into v_user;

  for v_route_item in select * from jsonb_array_elements(p_routes)
  loop
    insert into route_entries (user_id, order_index, route, status)
    values (v_user.id, (v_route_item->>'orderIndex')::int, v_route_item->>'route', 'Vivo')
    returning * into v_inserted;

    v_routes := v_routes || jsonb_build_array(jsonb_build_object(
      'id', v_inserted.id,
      'userId', v_inserted.user_id,
      'orderIndex', v_inserted.order_index,
      'route', v_inserted.route,
      'pokemonName', v_inserted.pokemon_name,
      'nickname', v_inserted.nickname,
      'level', v_inserted.level,
      'nature', v_inserted.nature,
      'status', v_inserted.status,
      'ability', v_inserted.ability,
      'item', v_inserted.item,
      'notes', v_inserted.notes,
      'isCustom', v_inserted.is_custom
    ));
  end loop;

  return jsonb_build_object(
    'id', v_user.id,
    'name', v_user.name,
    'color', v_user.color,
    'lives', v_user.lives,
    'wins', v_user.wins,
    'losses', v_user.losses,
    'status', v_user.status,
    'createdAt', v_user.created_at,
    'routes', v_routes
  );
end;
$$;

-- Guarda una fila de ruta y, si el cambio de estado entra o sale de
-- "Muerto", ajusta las vidas del usuario dueño en la misma transacción.
-- Usa "for update" para bloquear las filas leídas, igual que la transacción
-- de Firestore garantizaba lecturas consistentes antes de escribir.
create or replace function update_route_entry(
  p_route_id uuid,
  p_is_admin boolean,
  p_session_user_id uuid,
  p_pokemon_name text,
  p_nickname text,
  p_level int,
  p_nature text,
  p_status text,
  p_ability text,
  p_item text,
  p_notes text
) returns jsonb
language plpgsql
as $$
declare
  v_route route_entries%rowtype;
  v_user users%rowtype;
  v_old_status text;
  v_new_status text;
  v_lives_change boolean;
  v_user_json jsonb := null;
begin
  select * into v_route from route_entries where id = p_route_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not p_is_admin and (p_session_user_id is null or v_route.user_id <> p_session_user_id) then
    raise exception 'FORBIDDEN';
  end if;

  v_old_status := v_route.status;
  v_new_status := coalesce(p_status, v_old_status);
  v_lives_change := v_old_status <> v_new_status and (v_old_status = 'Muerto' or v_new_status = 'Muerto');

  update route_entries set
    pokemon_name = p_pokemon_name,
    nickname = coalesce(p_nickname, ''),
    level = p_level,
    nature = coalesce(p_nature, ''),
    status = v_new_status,
    ability = coalesce(p_ability, ''),
    item = coalesce(p_item, ''),
    notes = coalesce(p_notes, '')
  where id = p_route_id
  returning * into v_route;

  if v_lives_change then
    select * into v_user from users where id = v_route.user_id for update;
    if v_new_status = 'Muerto' and v_old_status <> 'Muerto' then
      update users set lives = greatest(0, lives - 1) where id = v_user.id returning * into v_user;
    elsif v_old_status = 'Muerto' and v_new_status <> 'Muerto' then
      update users set lives = least(30, lives + 1) where id = v_user.id returning * into v_user;
    end if;
    v_user_json := jsonb_build_object(
      'id', v_user.id,
      'name', v_user.name,
      'color', v_user.color,
      'lives', v_user.lives,
      'wins', v_user.wins,
      'losses', v_user.losses,
      'status', v_user.status
    );
  end if;

  return jsonb_build_object(
    'updated', jsonb_build_object(
      'id', v_route.id,
      'userId', v_route.user_id,
      'orderIndex', v_route.order_index,
      'route', v_route.route,
      'pokemonName', v_route.pokemon_name,
      'nickname', v_route.nickname,
      'level', v_route.level,
      'nature', v_route.nature,
      'status', v_route.status,
      'ability', v_route.ability,
      'item', v_route.item,
      'notes', v_route.notes,
      'isCustom', v_route.is_custom
    ),
    'user', v_user_json
  );
end;
$$;

-- Ofrece un Pokémon al fondo compartido de Wonder Trade. Si hay otra oferta
-- pendiente de otro participante, los empareja al instante; si no, deja la
-- oferta en cola. "for update skip locked" evita que dos ofertas simultáneas
-- se emparejen con el mismo candidato dos veces.
create or replace function wonder_trade_offer(
  p_user_id uuid,
  p_route_entry_id uuid
) returns jsonb
language plpgsql
as $$
declare
  v_route route_entries%rowtype;
  v_candidate wonder_trades%rowtype;
  v_partner_route route_entries%rowtype;
  v_new_trade wonder_trades%rowtype;
  v_now timestamptz := now();
begin
  select * into v_route from route_entries where id = p_route_entry_id for update;
  if not found or v_route.user_id <> p_user_id then
    raise exception 'NOT_OWNED';
  end if;
  if v_route.status <> 'Vivo' or v_route.pokemon_name is null or trim(v_route.pokemon_name) = '' then
    raise exception 'INVALID_OFFER';
  end if;

  -- Si ya tenías una oferta pendiente, la reemplazamos por esta.
  delete from wonder_trades where user_id = p_user_id and status = 'pending';

  -- Buscamos una oferta pendiente de otro participante (al azar entre las
  -- disponibles, igual que antes) y la bloqueamos para emparejar.
  select * into v_candidate
  from wonder_trades
  where status = 'pending' and user_id <> p_user_id
  order by random()
  limit 1
  for update skip locked;

  if not found then
    insert into wonder_trades (user_id, route_entry_id, pokemon_name, route_name, status)
    values (p_user_id, p_route_entry_id, v_route.pokemon_name, v_route.route, 'pending')
    returning * into v_new_trade;

    return jsonb_build_object(
      'matched', false,
      'pending', jsonb_build_object(
        'id', v_new_trade.id,
        'userId', v_new_trade.user_id,
        'routeEntryId', v_new_trade.route_entry_id,
        'pokemonName', v_new_trade.pokemon_name,
        'routeName', v_new_trade.route_name,
        'status', v_new_trade.status,
        'createdAt', v_new_trade.created_at
      )
    );
  end if;

  select * into v_partner_route from route_entries where id = v_candidate.route_entry_id for update;
  if not found then
    raise exception 'PARTNER_GONE';
  end if;

  -- Intercambiamos la especie entre ambas filas; el resto de la ficha
  -- (apodo, nivel, naturaleza...) se reinicia porque pasa a ser un
  -- individuo distinto.
  update route_entries set
    pokemon_name = v_partner_route.pokemon_name,
    nickname = '', level = null, nature = '', ability = '', item = '', notes = ''
  where id = v_route.id;

  update route_entries set
    pokemon_name = v_route.pokemon_name,
    nickname = '', level = null, nature = '', ability = '', item = '', notes = ''
  where id = v_partner_route.id;

  update wonder_trades set
    received_pokemon = v_route.pokemon_name,
    matched_with = p_user_id,
    status = 'completed',
    resolved_at = v_now
  where id = v_candidate.id;

  insert into wonder_trades (
    user_id, route_entry_id, pokemon_name, route_name,
    received_pokemon, matched_with, status, resolved_at
  ) values (
    p_user_id, p_route_entry_id, v_route.pokemon_name, v_route.route,
    v_partner_route.pokemon_name, v_candidate.user_id, 'completed', v_now
  );

  return jsonb_build_object(
    'matched', true,
    'received', v_partner_route.pokemon_name,
    'offered', v_route.pokemon_name
  );
end;
$$;
