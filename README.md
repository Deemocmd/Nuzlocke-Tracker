# Nuzlocke Tournament Hub

Hub del torneo Nuzlocke con backend real: **Firebase (Firestore)**, pensado
para desplegarse en **Vercel**. Cualquier persona puede iniciar sesión desde
cualquier dispositivo y ver/editar su progreso, porque todo (participantes,
fichas de ruta, noticias) vive en la base de datos, no en el navegador.

## Qué cambió respecto a la maqueta original

- Se quitó por completo la sección **Galería**.
- La **Ruleta** ya no es accesible para usuarios normales: solo la ve y la
  gira el perfil de **Administrador**.
- En la ficha Nuzlocke (**Mi Perfil**), el campo de captura ya no es un
  desplegable con una lista fija de "encuentros": ahora es un campo de
  texto libre donde puedes escribir el nombre de **cualquier Pokémon**, y se
  busca su sprite automáticamente en la PokeAPI.
- Los participantes, sus contraseñas (hasheadas) y sus 62 filas de ruta se
  crean y leen desde **Firestore vía Firebase Admin SDK**, no en memoria del
  navegador.
- El branding ya no menciona "ORAS" — quedó genérico para poder reutilizarse
  en el siguiente torneo, sea cual sea el juego.

## 1. Crear el proyecto de Firebase

1. Ve a la [Consola de Firebase](https://console.firebase.google.com/) y crea
   un proyecto nuevo (o usa uno existente).
2. Activa **Firestore Database** (modo producción está bien) desde
   **Build → Firestore Database → Crear base de datos**.
3. Genera una cuenta de servicio: **Configuración del proyecto (⚙️) →
   Cuentas de servicio → Generar nueva clave privada**. Se descarga un JSON
   con `project_id`, `client_email` y `private_key`.
4. De ese JSON necesitas 3 datos para las variables de entorno:
   - `FIREBASE_PROJECT_ID` → el `project_id`.
   - `FIREBASE_CLIENT_EMAIL` → el `client_email`.
   - `FIREBASE_PRIVATE_KEY` → el `private_key` (pégalo tal cual, con los
     `\n` incluidos).
5. Añade también:
   - `ADMIN_PASSWORD` → la contraseña que usará el/la administrador/a del
     torneo para entrar.
   - `JWT_SECRET` → una cadena larga y aleatoria (por ejemplo, generada con
     `openssl rand -hex 32`).

Define estas 5 variables tanto en tu `.env` local (copia `.env.example`)
como en **Vercel → Project Settings → Environment Variables**.

No hace falta crear colecciones a mano: Firestore las crea solas la primera
vez que la API escribe en ellas (`users`, `routeEntries`, `newsPosts`).

## 2. Reglas de seguridad de Firestore

Como toda la lectura/escritura pasa por las funciones serverless de `/api`
(que usan el Admin SDK, con permisos totales), puedes dejar el cliente de
Firestore cerrado a accesos externos. En **Firestore → Reglas** puedes usar:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## 3. Desarrollo local

```bash
npm install
npm run dev
```

Esto levanta Vite en local. Las funciones de `/api` (que usan Firebase
Admin) se ejecutan tal cual cuando despliegas en Vercel; para probarlas en
local con el mismo comportamiento de producción, usa `vercel dev` (instala
la CLI de Vercel con `npm i -g vercel` si no la tienes) en vez de
`npm run dev`.

## 4. Desplegar en Vercel

Sube el repositorio y conéctalo en Vercel (o `vercel --prod` desde la CLI).
El build es el estándar de Vite: `npm run build`. Asegúrate de que las 5
variables de entorno (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`, `ADMIN_PASSWORD`, `JWT_SECRET`) estén definidas en
el proyecto de Vercel antes de desplegar.

## 5. Primer uso

1. Entra con la pestaña **Administrador** y la contraseña de
   `ADMIN_PASSWORD`.
2. Ve al panel de **Administrador** y crea a cada participante (nombre +
   contraseña). Al crearlo se le genera automáticamente su ficha Nuzlocke
   con las zonas de Hoenn, lista para rellenar.
3. Comparte con cada jugador su nombre y contraseña: podrán entrar desde
   el móvil, el ordenador o cualquier dispositivo, eligiendo su nombre en
   la pestaña **Jugador** del login, y verán siempre los mismos datos
   porque están en Firestore, no en su navegador.

## Estructura relevante

```
shared/constants.js      Rutas de Hoenn y colores, compartidos por frontend y API
api/_lib/firebase.js     Cliente Firebase Admin (Firestore) singleton
api/_lib/auth.js         JWT de sesión + guards de admin/usuario
api/login.js             POST — login de admin o de jugador
api/users.js             GET/POST/DELETE — participantes y sus fichas
api/route-entry.js       PUT — guarda una fila de ruta/Pokémon
api/custom-route.js      POST/DELETE — filas extra que cada participante se agrega solo
api/wonder-trade.js      GET/POST/DELETE — intercambios prodigiosos
api/bracket.js           GET/POST/PUT/DELETE — Torneo Oficial (bracket suizo)
api/news.js              GET/POST — noticias del torneo
src/api.js               Cliente fetch del frontend hacia /api
src/usePokemonSprite.js  Busca el sprite de cualquier Pokémon por nombre en la PokeAPI
```

### Modelo de datos en Firestore

- **`users`** (colección): un doc por participante — `name`, `password`
  (hash bcrypt), `color`, `lives`, `wins`, `losses`, `status`, `createdAt`.
- **`routeEntries`** (colección): un doc por fila de ruta, con `userId`
  apuntando al participante dueño y `orderIndex` para el orden — `route`,
  `pokemonName`, `nickname`, `level`, `nature`, `status`, `ability`, `item`,
  `notes`, y opcionalmente `isCustom: true` si la agregó el propio
  participante (en vez de venir de las 62 rutas fijas de Hoenn).
- **`newsPosts`** (colección): `title`, `excerpt`, `createdAt`.
- **`wonderTrades`** (colección): historial y cola de los Intercambios
  prodigiosos — `userId`, `routeEntryId`, `pokemonName`, `status`
  (`pending`/`completed`), `receivedPokemon`, `matchedWith`, `createdAt`,
  `resolvedAt`.
- **`swissBracket`** (colección, un único documento `main`): el Torneo
  Oficial — `title`, `status` (`active`/`finished`), `participantIds`,
  `rounds` (array de fechas, cada una con sus combates).

## Funcionalidades nuevas

### Intercambios prodigiosos (pestaña "Intercambios", solo para jugadores)

Cada participante elige uno de sus Pokémon **vivos** y lo ofrece al fondo
compartido. Si en ese momento hay otra oferta pendiente de **otro**
participante, el sistema los empareja al instante y ambos reciben la
especie del otro en la misma fila que ofrecieron (apodo, nivel, naturaleza,
etc. de esa fila se reinician porque pasa a ser un individuo distinto). Si
nadie está esperando, la oferta queda en cola hasta que alguien mande la
suya — se puede cancelar en cualquier momento antes de que se empareje.

### Filas propias en la ficha Nuzlocke ("Mi Perfil")

Cada participante, viendo **su propia** ficha, tiene al final un cuadro
para agregarse filas extra con el nombre que quiera (por ejemplo, un
encuentro especial o un evento), además de sus 62 rutas fijas de Hoenn.
Puede borrarlas cuando quiera; solo puede borrar las que él mismo agregó
(no las rutas fijas). Nota: estas filas cuentan igual que cualquier otra
para el conteo de vidas si se marcan como "Muerto" — si prefieres que las
filas extra no descuenten vidas, avísame y lo ajusto.

### Torneo Oficial — bracket suizo (pestaña "Torneo Oficial", visible para todos)

Un bracket **nuevo y separado** del Bracket/Playoffs de eliminación directa
que ya existía (esos dos siguen intactos). Funciona así:

1. El administrador selecciona qué participantes entran y le pone un
   título; la Fecha 1 se empareja al azar.
2. En cada combate, el administrador toca el ícono de trofeo 🏆 junto al
   ganador para cargar el resultado. **Los jugadores no pueden tocar
   resultados** — solo ven el bracket, sin ningún control editable.
3. El administrador puede mover a cualquier participante a cualquier otro
   puesto del cuadro en cualquier momento con el ícono de flechas ⇄: lo
   toca una vez sobre el jugador de origen y otra vez sobre el puesto
   destino, y se intercambian.
4. Cuando todos los combates de la fecha tienen ganador, el botón "Generar
   siguiente fecha" arma la siguiente ronda emparejando a cada participante
   contra otro con su mismo récord (igual que el sistema suizo de la
   imagen de referencia).
5. "Finalizar torneo" cierra el bracket y muestra la clasificación final
   agrupada por récord. "Reiniciar" borra el torneo completo para empezar
   de nuevo.

La app no fuerza una cantidad fija de fechas ni de participantes (el
ejemplo de 32 jugadores / 3 fechas era solo ilustrativo) — funciona con
cualquier número de participantes y el administrador decide cuándo generar
la siguiente fecha o finalizar.

### Índices de Firestore que puede pedirte crear

Como con `routeEntries`, la primera vez que uses cada funcionalidad nueva
en producción, es posible que Firestore te muestre un error
`FAILED_PRECONDITION: The query requires an index` con un link directo
para crearlo (como ya te pasó antes). Es normal la primera vez: solo hay
que abrir ese link y confirmar "Crear índice", esperar 1-5 minutos a que
diga "Enabled", y volver a intentar.

## Notas y límites conocidos

- Las **Normas del torneo** (`normas`) siguen guardándose solo en memoria
  del navegador del administrador que las edita; no están en la base de
  datos. Si quieres que se persistan igual que el resto, dímelo y añado una
  colección `rulesDoc` con su propio endpoint.
- La configuración de la **Ruleta** (premios/castigos) también sigue siendo
  local a la sesión del administrador que la usa, ya que ahora es una
  herramienta solo-admin y no se pidió que se compartiera entre
  dispositivos.
- El **Bracket** y los **Playoffs** (eliminación directa de 32) siguen
  calculándose en el navegador a partir de la lista de participantes (no
  hay resultados de combates persistidos en la base de datos); si más
  adelante quieres registrar resultados de combates reales ahí también, se
  puede añadir una colección `matches`, igual que ya se hizo para el
  Torneo Oficial.
