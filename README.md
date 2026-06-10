# OpenTermX

OpenTermX es una base open source para una app de escritorio tipo terminal manager, inspirada en flujos de trabajo de administración remota pero con identidad propia y arquitectura modular.

## Stack

- Tauri 2
- React
- TypeScript
- Rust
- xterm.js
- SQLite local
- CSS Modules

## MVP actual

El MVP actual ya permite trabajar el flujo local completo y validar conexion SSH real:

- sesiones persistidas en SQLite local
- CRUD de sesiones desde la interfaz
- pestañas de terminal mock con `xterm.js`
- CRUD de túneles por sesión
- panel SFTP mock con navegación de ruta
- backend Tauri separado por módulos
- fallback web con datos en memoria para desarrollo de UI

## Estado actual

La app ya incluye:

- cambio de tema claro y oscuro
- administrador local de credenciales
- sesiones con autenticacion manual o por credencial guardada
- terminal SSH interactiva en `xterm.js`
- explorador SFTP con navegación, orden y acciones básicas

## Estructura

```text
opentermx/
├── database/
│   └── schema.sql
├── src/
│   ├── components/
│   │   ├── layout/
│   │   ├── sessions/
│   │   ├── sftp/
│   │   └── terminal/
│   ├── pages/
│   ├── services/
│   ├── stores/
│   ├── types/
│   ├── App.tsx
│   └── main.tsx
└── src-tauri/
    ├── capabilities/
    ├── src/
    │   ├── commands/
    │   ├── models/
    │   └── storage/
    └── tauri.conf.json
```

## Desarrollo

### Requisitos

- Node.js `14.18+` o superior
- npm `6+` o superior
- Rust + Cargo instalados
- dependencias del sistema para Tauri 2 según tu OS

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Ejecutar la app web:

   ```bash
   npm run dev
   ```

3. Ejecutar la app Tauri:

   ```bash
   npm run tauri dev
   ```

El comando `npm run tauri dev` reutiliza el servidor de Vite si ya lo tienes corriendo en `1420`, así evitamos el choque de puertos.

## Cómo probarlo antes del build

### 1) Probar solo la interfaz web

Usa este modo para revisar layout, tabs, modales, store y navegación mock:

```bash
npm run dev
```

Luego abre:

```text
http://localhost:1420
```

### 2) Probar la app de escritorio con backend Tauri

Usa este modo para validar:

- comandos Rust
- persistencia SQLite local
- CRUD real de sesiones
- CRUD real de túneles
- terminal SSH real
- SFTP real

Ejecuta:

```bash
npm run tauri dev
```

Si ya dejaste `npm run dev` abierto en otra terminal, `npm run tauri dev` lo reutiliza.

### 3) Flujo recomendado de prueba manual

Antes de empaquetar para Linux, macOS o Windows, prueba este orden:

1. abrir la app
2. crear una credencial en el administrador
3. crear una sesión nueva con esa credencial o con usuario y contraseña manual
4. editar esa sesión
5. abrir una pestaña de terminal y verificar la autenticacion SSH
6. crear un túnel asociado si lo necesitas
7. cerrar y reabrir la app
8. comprobar que sesiones, credenciales y túneles siguen guardados
9. cambiar la ruta en el panel SFTP mock y refrescar

### 4) Si algo falla al correr

- si falla `npm run dev`, revisa que el puerto `1420` no esté ocupado
- si falla `npm run tauri dev`, revisa que `cargo` y Rust estén instalados
- si Tauri falla por dependencias del sistema, instala los prerequisitos oficiales para tu SO

## Notas técnicas

- el terminal usa `@xterm/xterm` y `@xterm/addon-fit`
- `xterm` se carga por `dynamic import` para mantener el bundle inicial más liviano
- los iconos de Tauri viven en `src-tauri/icons/`
- para regenerarlos desde tu PNG maestro usa:

  ```bash
  npm run tauri icon src-tauri/icons/icon.png -o src-tauri/icons
  ```

- Tauri usa `icon.icns` en macOS, `icon.ico` en Windows y PNGs en Linux
- las credenciales se guardan localmente en SQLite; todavia no estan cifradas

## Build local

### Salida de bundles

Todos los instaladores y bundles quedan en:

```text
src-tauri/target/release/bundle/
```

### macOS

```bash
npm install
npm run tauri build -- --bundles app,dmg
```

Genera:

- `.app`
- `.dmg`

### Windows

```bash
npm install
npm run tauri build -- --bundles msi,nsis
```

Genera:

- `.msi`
- `setup.exe`

### Ubuntu / Linux

```bash
npm install
npm run tauri build -- --bundles deb,appimage
```

Genera:

- `.deb`
- `.AppImage`

## GitHub Actions

Se agregó un workflow en:

```text
.github/workflows/release.yml
```

Este workflow:

- compila en `macOS`, `Windows` y `Ubuntu`
- crea un draft release en GitHub
- adjunta los bundles generados por Tauri

### Cómo usarlo

1. sube el proyecto a GitHub
2. crea un tag con formato `v0.1.0`
3. haz push del tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
