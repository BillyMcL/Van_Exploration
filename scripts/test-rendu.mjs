#!/usr/bin/env node
/**
 * Contrôles sur le site construit.
 *
 * Le schéma de `donnees.ts` garantit que le fichier source ne porte ni ordre ni
 * date. Il ne dit rien de ce qui est réellement rendu : un composant pourrait
 * trier, filtrer ou réordonner en chemin. L'ordre du DOM est une information au
 * même titre que l'ordre du tableau JSON, et il se vérifie sur la sortie.
 *
 * À lancer après `npm run build`.
 *
 * Usage : node scripts/test-rendu.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PAGE = join(RACINE, 'site', 'dist', 'itineraire', 'index.html');
const SOURCE_CARTE = join(RACINE, 'site', 'src', 'components', 'Carte.astro');

if (!existsSync(PAGE)) {
  console.error(`\nPage construite introuvable : ${PAGE}`);
  console.error('Lancer `npm run build` dans site/ avant ce test.\n');
  process.exit(1);
}

const geojson = JSON.parse(readFileSync(join(RACINE, 'data', 'pays-traverses.geojson'), 'utf8'));
const attendu = geojson.features.map((f) => f.properties.pays);
const html = readFileSync(PAGE, 'utf8');

let echecs = 0;
const verifier = (ok, libelle, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'}  ${libelle}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) echecs++;
};

console.log('Rendu de la page itinéraire :\n');

/* -------------------------------------------- ordre du repli sans JavaScript */

const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/i)?.[1] ?? '';
// Astro appose des attributs de scoping (`data-astro-cid-…`) sur chaque balise :
// l'ouvrante ne peut pas être appariée telle quelle.
const rendus = [...noscript.matchAll(/<li[^>]*>([^<]+)<\/li>/g)].map((m) => m[1].trim());

verifier(rendus.length === attendu.length,
  `le repli noscript liste les ${attendu.length} pays`,
  `${rendus.length} trouvés : ${rendus.join(', ') || '(aucun)'}`);

verifier(rendus.join('|') === attendu.join('|'),
  'l\'ordre du DOM est celui du fichier, alphabétique',
  `rendu   : ${rendus.join(', ')}\n      attendu : ${attendu.join(', ')}`);

/* ------------------------------------------- ordre de la charge utile client */

const charge = html.match(/id="donnees-carte"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
let ordreClient = [];
let etapesClient = [];
try {
  const donnees = JSON.parse(charge ?? '{}');
  ordreClient = (donnees.pays ?? []).map((p) => p.nom);
  etapesClient = (donnees.etapes ?? []).map((e) => e.nom);
} catch { /* laissé vide : les assertions suivantes le signaleront */ }

verifier(ordreClient.join('|') === attendu.join('|'),
  'l\'ordre des données passées au client est le même',
  `client : ${ordreClient.join(', ') || '(illisible)'}`);

// La couche rétrospective obéit à la même règle que les pays : l'ordre du
// fichier ne doit rien apprendre. L'export la range alphabétiquement ; on le
// vérifie sur ce qui est réellement servi, pas sur ce que l'export prétend faire.
const etapesTriees = [...etapesClient].sort((a, b) => a.localeCompare(b, 'fr'));
verifier(etapesClient.join('|') === etapesTriees.join('|'),
  etapesClient.length
    ? `les ${etapesClient.length} lieux quittés sont rangés alphabétiquement`
    : 'aucun lieu publié — rien dont l\'ordre puisse trahir une séquence',
  `rendu : ${etapesClient.join(', ')}`);

/* ------------------------------------------------------- absence de tracé */

const source = readFileSync(SOURCE_CARTE, 'utf8');
verifier(!/L\.[Pp]olyline\s*\(/.test(source) && !/L\.[Pp]olygon\s*\(/.test(source),
  'le composant n\'instancie aucune polyligne',
  'Relier les marqueurs donnerait un ordre de passage, donc un calendrier.');

verifier(/ordre et dates non publi/i.test(html),
  'la légende annonce que l\'ordre et les dates ne sont pas publiés');

/* ------------------------------------------------------------------ verdict */

if (echecs > 0) {
  console.error(`\n${echecs} contrôle(s) en échec sur le rendu.\n`);
  process.exit(1);
}
console.log('\nRendu vérifié : aucune séquence ne transparaît, ni dans le DOM ni côté client.\n');
