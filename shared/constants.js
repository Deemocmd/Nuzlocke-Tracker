// Constantes compartidas entre el frontend (src/App.jsx) y las funciones
// serverless (api/*). Vivir en un solo sitio evita que la ficha Nuzlocke que
// se crea en el backend y la que se pinta en pantalla se desincronicen.

export const HOENN_LOCATIONS = [
  'Ruta 101', 'Ruta 102', 'Ruta 103', 'Ruta 104 (Norte y Sur)', 'Ruta 105 (Marítima)',
  'Ruta 106 (Marítima)', 'Ruta 107 (Marítima)', 'Ruta 108 (Marítima)', 'Ruta 109 (Playa/Marítima)',
  'Ruta 110', 'Ruta 111 (Incluye el Desierto)', 'Ruta 112', 'Ruta 113', 'Ruta 114', 'Ruta 115',
  'Ruta 116', 'Ruta 117', 'Ruta 118', 'Ruta 119', 'Ruta 120', 'Ruta 121',
  'Ruta 122 (Alrededores del Monte Pírico)', 'Ruta 123', 'Ruta 124 (Marítima / Buceo)',
  'Ruta 125 (Marítima)', 'Ruta 126 (Marítima / Buceo)', 'Ruta 127 (Marítima / Buceo)',
  'Ruta 128 (Marítima / Buceo)', 'Ruta 129 (Marítima)', 'Ruta 130 (Marítima)', 'Ruta 131 (Marítima)',
  'Ruta 132 (Corrientes marinas)', 'Ruta 133 (Corrientes marinas)', 'Ruta 134 (Corrientes marinas)',
  'Villa Raíz', 'Pueblo Escaso', 'Ciudad Petalia', 'Ciudad Férrica', 'Pueblo Azuliza',
  'Ciudad Portual', 'Ciudad Malvalona', 'Pueblo Verdegal', 'Pueblo Lavacalda', 'Ciudad Arborada',
  'Ciudad Calagua', 'Ciudad Arrecípolis', 'Pueblo Oromar', 'Ciudad Colosalia',
  'Bosque Petalia', 'Cueva Granito', 'Túnel Férrico', 'Senda Ígnea', 'Monte Cenizo',
  'Cueva Cascada', 'Malvalanova', 'Monte Pírico', 'Guarida del Equipo Magma', 'Zona Zafari',
  'Cueva Ancestral', 'Caverna Abisal', 'Nao Abandonado', 'Cueva Cardumen', 'Calle Victoria',
  'Pilar Celeste', 'Santuario Marino',
];

export const USER_COLOR_POOL = [
  'bg-red-600', 'bg-amber-500', 'bg-emerald-600', 'bg-indigo-600', 'bg-pink-600',
  'bg-cyan-600', 'bg-orange-600', 'bg-violet-600', 'bg-lime-600', 'bg-teal-600',
  'bg-fuchsia-600', 'bg-sky-600',
];

export const STATUSES = ['Vivo', 'Muerto', 'Caja', 'Equipo'];
export const NATURES = ['Firme', 'Modesta', 'Alegre', 'Tímida', 'Serena', 'Audaz', 'Solitaria', 'Pícara', 'Dócil', 'Cauta', 'Seria', 'Extraña'];
