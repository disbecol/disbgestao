import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'src', 'gestao-app');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!fs.existsSync(path.join(output, 'forms-react.js'))) throw Error('Compile o frontend React antes de preparar o cache.');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(dir, entry.name))
    : [path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/')]);
}
const assets = files(output).sort().map(file => file.endsWith('/forms-react.js') ? file + '?v=' + version : file);
const start = '// BEGIN GENERATED FRONTEND ASSETS', end = '// END GENERATED FRONTEND ASSETS';
const block = `${start}\nSTATIC.push(...${JSON.stringify(assets, null, 2)});\n${end}\n`;
const target = path.join(root, 'sw.js');
let sw = fs.readFileSync(target, 'utf8');
if (sw.includes(start)) sw = sw.replace(new RegExp(`${start}[\\s\\S]*?${end}\\r?\\n`), block);
else if (sw.includes('const STATIC_URLS=')) sw = sw.replace('const STATIC_URLS=', block + 'const STATIC_URLS=');
else throw Error('Limite do cache offline não encontrado.');
fs.writeFileSync(target, sw);
console.log(`Cache do frontend React preparado: ${assets.length} arquivo(s).`);
