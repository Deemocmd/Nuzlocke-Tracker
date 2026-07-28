-- =============================================================================
-- Nuzlocke Hub — esquema de Supabase (Postgres)
-- Reemplaza a Firestore. Ejecuta este archivo completo en:
-- Supabase Dashboard -> SQL Editor -> New query -> pegar todo -> Run
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tablas
-- -----------------------------------------------------------------------------

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  password text not null, -- hash de bcrypt, nunca texto plano
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
  order_index int not null default 0,
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

create table if not exists news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  excerpt text not null default '',
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
  status text not null default 'pending', -- pending | completed
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists wonder_trades_user_status_idx on wonder_trades(user_id, status);
create index if not exists wonder_trades_status_idx on wonder_trades(status);

create table if not exists direct_trades (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references users(id) on delete cascade,
  from_route_entry_id uuid not null references route_entries(id) on delete cascade,
  offered_pokemon text,
  offered_route_name text,
  requested_pokemon text not null,
  status text not null default 'pending', -- pending | completed
  to_user_id uuid references users(id),
  to_route_entry_id uuid references route_entries(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists direct_trades_from_status_idx on direct_trades(from_user_id, status);
create index if not exists direct_trades_to_status_idx on direct_trades(to_user_id, status);
create index if not exists direct_trades_status_idx on direct_trades(status);

-- El bracket suizo se guarda como una única fila (equivalente al doc "main"
-- que tenías en Firestore).
create table if not exists swiss_bracket (
  id text primary key,
  title text not null,
  status text not null default 'active',
  participant_ids jsonb not null default '[]',
  rounds jsonb not null default '[]'
);

-- -----------------------------------------------------------------------------
-- Row Level Security: la app solo habla con Supabase desde las funciones
-- serverless de /api usando la Service Role Key (que salta RLS). Dejamos RLS
-- activado y sin políticas para que, si alguna vez se filtrara la clave
-- pública (anon), nadie pueda leer/escribir directo desde el navegador.
-- -----------------------------------------------------------------------------
alter table users enable row level security;
alter table route_entries enable row level security;
alter table news_posts enable row level security;
alter table wonder_trades enable row level security;
alter table direct_trades enable row level security;
alter table swiss_bracket enable row level security;

-- -----------------------------------------------------------------------------
-- Funciones transaccionales (plpgsql)
-- Reemplazan a los db.runTransaction(...) / db.batch() de Firestore, usando
-- bloqueos de fila (FOR UPDATE) para que sigan siendo atómicas.
-- -----------------------------------------------------------------------------

-- Crea un participante junto con sus filas de ruta iniciales en una sola
-- transacción. p_routes es un array de nombres de ruta (HOENN_LOCATIONS).
create or replace function create_user_with_routes(
  p_name text,
  p_password text,
  p_color text,
  p_routes text[]
) returns uuid
language plpgsql
as $$
declare
  v_user_id uuid;
  v_route text;
  v_idx int := 1;
begin
  if exists (select 1 from users where name = p_name) then
    raise exception 'DUPLICATE_NAME';
  end if;

  insert into users (name, password, color, lives, wins, losses, status)
  values (p_name, p_password, p_color, 30, 0, 0, 'Activo')
  returning id into v_user_id;

  foreach v_route in array p_routes loop
    insert into route_entries (user_id, order_index, route, status, is_custom)
    values (v_user_id, v_idx, v_route, 'Vivo', false);
    v_idx := v_idx + 1;
  end loop;

  return v_user_id;
end;
$$;

-- Actualiza una fila de ruta y, si el estado cruza hacia/desde "Muerto",
-- ajusta las vidas del usuario dueño en la misma transacción.
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
  v_route route_entries;
  v_old_status text;
  v_new_status text;
  v_lives_change boolean := false;
  v_new_lives int;
begin
  select * into v_route from route_entries where id = p_route_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not p_is_admin and v_route.user_id <> p_session_user_id then
    raise exception 'FORBIDDEN';
  end if;

  v_old_status := v_route.status;
  v_new_status := coalesce(p_status, v_old_status);

  update route_entries set
    pokemon_name = p_pokemon_name,
    nickname = coalesce(p_nickname, ''),
    level = p_level,
    nature = coalesce(p_nature, ''),
    status = v_new_status,
    ability = coalesce(p_ability, ''),
    item = coalesce(p_item, ''),
    notes = coalesce(p_notes, '')
  where id = p_route_id;

  if v_old_status is distinct from v_new_status and (v_old_status = 'Muerto' or v_new_status = 'Muerto') then
    v_lives_change := true;
    update users set lives = case
        when v_new_status = 'Muerto' and v_old_status <> 'Muerto' then greatest(0, lives - 1)
        when v_old_status = 'Muerto' and v_new_status <> 'Muerto' then least(30, lives + 1)
        else lives
      end
    where id = v_route.user_id
    returning lives into v_new_lives;
  end if;

  return jsonb_build_object('userId', v_route.user_id, 'livesChanged', v_lives_change, 'lives', v_new_lives);
end;
$$;

-- Resuelve un emparejamiento de Intercambio Prodigioso: intercambia las
-- especies entre las dos filas de ruta y marca ambas ofertas como completadas.
create or replace function resolve_wonder_trade(
  p_my_user_id uuid,
  p_my_route_id uuid,
  p_candidate_trade_id uuid
) returns jsonb
language plpgsql
as $$
declare
  v_candidate wonder_trades;
  v_partner_route route_entries;
  v_my_route route_entries;
begin
  select * into v_candidate from wonder_trades where id = p_candidate_trade_id and status = 'pending' for update;
  if not found then
    raise exception 'PARTNER_GONE';
  end if;

  select * into v_partner_route from route_entries where id = v_candidate.route_entry_id for update;
  if not found then
    raise exception 'PARTNER_GONE';
  end if;

  select * into v_my_route from route_entries where id = p_my_route_id for update;

  update route_entries set pokemon_name = v_partner_route.pokemon_name,
    nickname = '', level = null, nature = '', ability = '', item = '', notes = ''
  where id = p_my_route_id;

  update route_entries set pokemon_name = v_my_route.pokemon_name,
    nickname = '', level = null, nature = '', ability = '', item = '', notes = ''
  where id = v_candidate.route_entry_id;

  insert into wonder_trades (user_id, route_entry_id, pokemon_name, route_name, received_pokemon, matched_with, status, resolved_at)
  values (p_my_user_id, p_my_route_id, v_my_route.pokemon_name, v_my_route.route, v_partner_route.pokemon_name, v_candidate.user_id, 'completed', now());

  update wonder_trades set
    received_pokemon = v_my_route.pokemon_name,
    matched_with = p_my_user_id,
    status = 'completed',
    resolved_at = now()
  where id = p_candidate_trade_id;

  return jsonb_build_object('received', v_partner_route.pokemon_name, 'offered', v_my_route.pokemon_name);
end;
$$;

-- Acepta una oferta de trueque directo: valida especie pedida, intercambia
-- las especies entre las dos filas y cierra la oferta.
create or replace function accept_direct_trade(
  p_offer_id uuid,
  p_my_user_id uuid,
  p_my_route_id uuid
) returns jsonb
language plpgsql
as $$
declare
  v_offer direct_trades;
  v_my_route route_entries;
  v_from_route route_entries;
begin
  select * into v_offer from direct_trades where id = p_offer_id and status = 'pending' for update;
  if not found then raise exception 'OFFER_GONE'; end if;
  if v_offer.from_user_id = p_my_user_id then raise exception 'OWN_OFFER'; end if;

  select * into v_my_route from route_entries where id = p_my_route_id for update;
  if not found or v_my_route.user_id <> p_my_user_id then raise exception 'NOT_MINE'; end if;
  if v_my_route.status <> 'Vivo' or v_my_route.pokemon_name is null or trim(v_my_route.pokemon_name) = '' then
    raise exception 'NOT_ALIVE';
  end if;
  if lower(trim(v_my_route.pokemon_name)) <> lower(trim(v_offer.requested_pokemon)) then
    raise exception 'SPECIES_MISMATCH';
  end if;

  select * into v_from_route from route_entries where id = v_offer.from_route_entry_id for update;
  if not found then raise exception 'OFFER_GONE'; end if;

  update route_entries set pokemon_name = v_my_route.pokemon_name,
    nickname = '', level = null, nature = '', ability = '', item = '', notes = ''
  where id = v_from_route.id;

  update route_entries set pokemon_name = v_offer.offered_pokemon,
    nickname = '', level = null, nature = '', ability = '', item = '', notes = ''
  where id = v_my_route.id;

  update direct_trades set
    status = 'completed',
    to_user_id = p_my_user_id,
    to_route_entry_id = p_my_route_id,
    resolved_at = now()
  where id = p_offer_id;

  return jsonb_build_object('received', v_offer.offered_pokemon, 'given', v_my_route.pokemon_name);
end;
$$;
