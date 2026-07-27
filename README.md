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
api/news.js               GET/POST — noticias del torneo
src/api.js               Cliente fetch del frontend hacia /api
src/usePokemonSprite.js  Busca el sprite de cualquier Pokémon por nombre en la PokeAPI
```

### Modelo de datos en Firestore

- **`users`** (colección): un doc por participante — `name`, `password`
  (hash bcrypt), `color`, `lives`, `wins`, `losses`, `status`, `createdAt`.
- **`routeEntries`** (colección): un doc por fila de ruta, con `userId`
  apuntando al participante dueño y `orderIndex` para el orden — `route`,
  `pokemonName`, `nickname`, `level`, `nature`, `status`, `ability`, `item`,
  `notes`.
- **`newsPosts`** (colección): `title`, `excerpt`, `createdAt`.

## Notas y límites conocidos

- Las **Normas del torneo** (`normas`) siguen guardándose solo en memoria
  del navegador del administrador que las edita; no están en la base de
  datos. Si quieres que se persistan igual que el resto, dímelo y añado una
  colección `rulesDoc` con su propio endpoint.
- La configuración de la **Ruleta** (premios/castigos) también sigue siendo
  local a la sesión del administrador que la usa, ya que ahora es una
  herramienta solo-admin y no se pidió que se compartiera entre
  dispositivos.
- El **Bracket** y los **Playoffs** siguen calculándose en el navegador a
  partir de la lista de participantes (no hay resultados de combates
  persistidos en la base de datos); si más adelante quieres registrar
  resultados de combates reales, se puede añadir una colección `matches`.
