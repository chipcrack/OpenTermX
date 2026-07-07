# Stack Tecnologico de OpenTermX

## Resumen

OpenTermX esta construido como una aplicacion de escritorio multiplataforma con una UI web embebida. La arquitectura se divide en:

- Frontend en `React 18` + `TypeScript`
- Empaquetado y runtime desktop con `Tauri 2`
- Backend nativo en `Rust`
- Persistencia local en `SQLite`
- Conexion remota por `SSH` y exploracion de archivos por `SFTP`

No hay un backend HTTP separado ni un servidor API tradicional: el frontend habla directamente con comandos nativos de Tauri.

## Frontend

### Base

- `React 18.3.1`
- `TypeScript 5.5`
- `Vite 4.5`
- `@vitejs/plugin-react`

### Estado y estructura

- `Zustand` para manejo de estado global
- Sin `React Router`: la app renderiza una sola pagina principal tipo workspace
- Sin librerias de fetch/cache como `React Query`
- Sin framework UI externo como MUI, Ant Design, Chakra o Tailwind

### UI y estilos

- CSS global en `src/styles/global.css`
- `CSS Modules` por componente para encapsular estilos
- Tema `dark/light` manejado con variables CSS y persistido en `localStorage`
- Tipografia principal del terminal: `JetBrains Mono`

### Terminal en la UI

- `@xterm/xterm`
- `@xterm/addon-fit`

La terminal visual se monta en React, pero la ejecucion real ocurre en Rust a traves de SSH cuando corre dentro de Tauri.

## Capa Desktop

### Runtime y shell desktop

- `Tauri 2`
- `@tauri-apps/api` en frontend
- `@tauri-apps/cli` para desarrollo/build

### Configuracion observada

- Ventana principal fija en `1600x960`
- Minimo de ventana `1200x720`
- `withGlobalTauri: false`
- CSP en `null`
- Capacidad desktop actual: `core:default`

### Empaquetado

- Target de bundle: `NSIS`
- Instalador Windows configurado como `perMachine`
- Selector de idioma del instalador en `Spanish` y `English`

Esto indica que hoy el flujo de distribucion esta orientado principalmente a Windows.

## Backend Nativo

### Lenguaje y crates

- `Rust edition 2021`
- `tauri`
- `serde`
- `serde_json`
- `thiserror`
- `chrono`
- `rusqlite` con feature `bundled`
- `ssh2` con feature `vendored-openssl`

### Responsabilidades del backend Rust

- Inicializar y migrar la base de datos local
- Exponer comandos Tauri al frontend
- Resolver credenciales y sesiones guardadas
- Abrir shells remotas por SSH
- Leer y escribir I/O de terminal
- Redimensionar PTY remoto
- Operaciones SFTP: listar, crear carpetas, renombrar y borrar

## Persistencia

### Motor

- `SQLite` local
- Archivo de base: `opentermx.sqlite3`
- Ubicacion: directorio `app_data_dir` de Tauri

### Acceso a datos

- Acceso directo con `rusqlite`
- Conexion compartida protegida con `Mutex<Connection>`
- Migraciones iniciales ejecutadas desde `database/schema.sql`

### Tablas principales

- `sessions`
- `credentials`
- `tunnels`

### Modelo de datos funcional

- Sesiones SSH
- Credenciales reutilizables
- Tuneles/port forwarding asociados a sesiones

Tambien existe seed inicial con datos demo si la base esta vacia.

## Comunicacion entre capas

El flujo principal es:

1. React invoca funciones de `desktopApi`
2. `desktopApi` usa `invoke(...)` de Tauri
3. Tauri llama comandos Rust
4. Rust consulta SQLite o abre conexiones SSH/SFTP
5. Los resultados vuelven tipados al frontend

Comandos nativos expuestos:

- Credenciales: listar, guardar, eliminar
- Sesiones: listar, guardar, eliminar
- Tuneles: listar, guardar, eliminar
- Terminal SSH: abrir, leer salida, escribir entrada, resize, cerrar
- SFTP: listar directorio, crear carpeta, renombrar, eliminar

## SSH y SFTP

### SSH

- Conexion con `ssh2`
- Autenticacion actual por usuario + password
- Solicitud de PTY remoto `xterm-256color`
- Shell remota interactiva
- Polling desde frontend para leer salida

### SFTP

- Reutiliza autenticacion resuelta desde la sesion
- Lista el home remoto por defecto: `/home/{username}`
- Permite:
  - listar directorios
  - crear carpetas
  - renombrar entradas
  - eliminar archivos o carpetas

## Modo desarrollo y fallback web

La app tiene dos formas de correr:

### 1. Desktop real

- `npm run dev:tauri`
- Arranca Vite y Tauri juntos
- Usa backend Rust real, SQLite real y SSH/SFTP real

### 2. Modo web/mock

Si no detecta runtime Tauri:

- usa datos mock en memoria
- simula sesiones, credenciales, tuneles, terminal y SFTP
- permite desarrollar la UI sin depender del runtime nativo

Esto esta implementado en `src/services/desktopApi.ts`.

## Build y herramientas

### Scripts detectados

- `npm run dev`
- `npm run dev:raw`
- `npm run dev:tauri`
- `npm run build`
- `npm run preview`
- `npm run tauri`

### Package manager

- `npm`
- Lockfile presente: `package-lock.json`

## Arquitectura del proyecto

### Frontend

- `src/components`: UI por dominios (`sessions`, `terminal`, `sftp`, `layout`, `credentials`)
- `src/pages`: pagina principal del workspace
- `src/stores`: estado global con Zustand
- `src/services`: puente con Tauri y mocks
- `src/types`: contratos TypeScript

### Backend

- `src-tauri/src/commands`: comandos Tauri por dominio
- `src-tauri/src/storage`: acceso SQLite y migracion
- `src-tauri/src/models`: structs compartidos
- `src-tauri/tauri.conf.json`: configuracion desktop/bundle
- `database/schema.sql`: esquema SQL

## Lo que no aparece en este proyecto

No se observa configurado en el repo:

- `Next.js`
- `Electron`
- backend REST/GraphQL
- `Tailwind CSS`
- `Redux`
- tests automatizados
- `ESLint`
- `Prettier`
- CI/CD de build o test dentro del codigo revisado
- contenedores Docker

## Conclusion

OpenTermX es una aplicacion desktop de administracion remota construida con stack web + nativo:

- `React + TypeScript + Vite` para la interfaz
- `Tauri + Rust` para runtime desktop y logica nativa
- `SQLite` para persistencia local
- `SSH/SFTP` para operacion remota
- `Zustand + xterm.js + CSS Modules` para experiencia de usuario

Su arquitectura evita un backend externo y concentra toda la logica local en Tauri, lo que la vuelve una app desktop autocontenida.
