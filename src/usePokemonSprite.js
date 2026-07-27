import { useEffect, useState } from 'react';

const cache = new Map();

// Cualquier nombre de Pokémon vale (no solo los de una lista fija de
// encuentros): buscamos el sprite en la PokeAPI pública según lo que
// escriba la persona, con un pequeño debounce y caché en memoria.
export function usePokemonSprite(name) {
  const [sprite, setSprite] = useState(null);

  useEffect(() => {
    const clean = String(name || '').trim().toLowerCase();
    if (!clean) {
      setSprite(null);
      return undefined;
    }
    if (cache.has(clean)) {
      setSprite(cache.get(clean));
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(clean)}`);
        if (!res.ok) throw new Error('not found');
        const data = await res.json();
        const url = (data.sprites && data.sprites.front_default) || null;
        cache.set(clean, url);
        if (!cancelled) setSprite(url);
      } catch {
        cache.set(clean, null);
        if (!cancelled) setSprite(null);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [name]);

  return sprite;
}
