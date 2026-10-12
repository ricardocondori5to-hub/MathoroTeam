import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const publicFiles = [
  'controles.html', 'empiezo.html', 'estilos.css', 'gameLogic.js', 'index.html',
  'jugar.html', 'login.html', 'logros.html', 'manifest.json', 'nivel1.html',
  'opciones.html', 'preguntas.js', 'pwa-responsive.css', 'pwa-runtime.js', 'sonidos-ui.js', 'transiciones.css', 'transiciones.js',
  'ranking.html', 'recomp.html', 'uiController.js', 'audioEngine.js', 'sw.js',
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of publicFiles) await cp(path.join(root, file), path.join(output, file));
for (const directory of ['imagenes', 'videos']) {
  const source = path.join(root, directory);
  const entries = await readdir(source);
  if (entries.length) await cp(source, path.join(output, directory), { recursive: true });
}
console.log(`Sitio estático preparado en ${path.relative(root, output)}.`);
