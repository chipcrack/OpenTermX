# OpenTermX

OpenTermX es una aplicacion de escritorio para organizar sesiones remotas, abrir terminales SSH y trabajar con tuneles y archivos desde una sola interfaz.

Esta construida con Tauri 2, React, TypeScript, Rust, `xterm.js` y SQLite local.

## Que puedes hacer hoy

- guardar sesiones de conexion en SQLite local
- crear, editar y eliminar sesiones desde la interfaz
- abrir terminales SSH interactivas
- crear y administrar tuneles por sesion
- explorar archivos en un panel SFTP
- guardar credenciales localmente para reutilizarlas
- usar tema claro y oscuro

## Descargas e instalacion

Los builds publicados suelen incluir:

- macOS: `.app` y `.dmg`
- Windows: `.msi` y `setup.exe`
- Linux: `.deb` y, cuando este disponible, `.AppImage`

### macOS

Por ahora la app se construye sin firma de Apple. Eso significa que macOS puede bloquearla al abrirla por primera vez aunque el archivo sea legitimo.

Flujo recomendado:

1. Descarga el `.dmg`.
2. Abre el `.dmg`.
3. Arrastra `OpenTermX.app` a `Applications`.
4. Si macOS muestra un mensaje tipo "la app esta dañada" o no permite abrirla, abre `Terminal`.
5. Escribe `xattr -cr ` y, sin presionar Enter todavia, arrastra `OpenTermX.app` a la ventana de Terminal.
6. Presiona Enter.
7. Intenta abrir la app de nuevo.

Ejemplo si ya sabes la ruta exacta:

```bash
xattr -cr /Applications/OpenTermX.app
```

Si macOS sigue pidiendo confirmacion, prueba abrirla una primera vez con clic derecho > `Open`.

### Windows

Descarga el instalador `.msi` o `setup.exe` y sigue el asistente.

### Linux

Si tu distribucion es compatible con paquetes Debian, usa el `.deb`.

Si la release incluye `.AppImage`, puedes darle permisos y ejecutarla:

```bash
chmod +x OpenTermX.AppImage
./OpenTermX.AppImage
```

## Ejecutar desde codigo

### Requisitos

- Node.js `20` o superior
- npm `9` o superior
- Rust y Cargo instalados
- dependencias del sistema para Tauri 2 segun tu sistema operativo

### Instalar dependencias

```bash
npm install
```

### Ejecutar la interfaz web

```bash
npm run dev
```

Luego abre:

```text
http://localhost:1420
```

### Ejecutar la app de escritorio con Tauri

```bash
npm run tauri dev
```

Si ya tienes `npm run dev` corriendo en otra terminal, `npm run tauri dev` reutiliza ese servidor en el puerto `1420`.

## Prueba manual recomendada

Antes de generar instaladores, conviene probar este flujo:

1. Abre la app.
2. Crea una credencial en el administrador.
3. Crea una sesion nueva usando esa credencial o usuario y contraseña manual.
4. Edita la sesion.
5. Abre una pestaña de terminal y valida la autenticacion SSH.
6. Crea un tunel si lo necesitas.
7. Cierra y vuelve a abrir la app.
8. Comprueba que sesiones, credenciales y tuneles siguen guardados.
9. Cambia la ruta en el panel SFTP y refresca.

## Si algo falla al ejecutar

- Si falla `npm run dev`, revisa que el puerto `1420` no este ocupado.
- Si falla `npm run tauri dev`, revisa que `cargo` y Rust esten instalados.
- Si Tauri falla por dependencias del sistema, instala los prerequisitos oficiales para tu sistema operativo.
- Si aparece un error de PostCSS o `tailwindcss`, normalmente faltan dependencias del frontend y se corrige con `npm install`.

## Compilar instaladores

Los bundles se generan en:

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

Importante:

- Este build de macOS no esta firmado.
- Para abrirlo en otra Mac puede hacer falta ejecutar `xattr -cr` sobre `OpenTermX.app`.

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

## Publicacion automatica con GitHub Actions

El workflow esta en:

```text
.github/workflows/release.yml
```

Ese workflow:

- construye macOS, Windows y Ubuntu
- publica un draft release en GitHub
- adjunta los bundles generados por Tauri
- deja el build de `AppImage` separado para que un fallo externo no bloquee el `.deb`

### Como usarlo

1. Sube el proyecto a GitHub.
2. Crea un tag con formato `v0.1.0`.
3. Haz push del tag.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Notas tecnicas

- El terminal usa `@xterm/xterm` y `@xterm/addon-fit`.
- `xterm` se carga por `dynamic import` para mantener el bundle inicial mas liviano.
- Los iconos de Tauri estan en `src-tauri/icons/`.
- Tauri usa `icon.icns` en macOS, `icon.ico` en Windows y PNGs en Linux.
- Las credenciales se guardan localmente en SQLite y todavia no estan cifradas.
