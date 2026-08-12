#!/usr/bin/env node
/**
 * Test du garde-fou.
 *
 * Un garde-fou jamais déclenché est un garde-fou qu'on croit fonctionnel. Ce test
 * fabrique des fichiers volontairement fautifs dans un dossier temporaire, vérifie
 * que chaque règle mord, puis vérifie qu'un dossier propre passe. Il tourne à
 * chaque CI, avant le garde-fou lui-même.
 *
 * Aucun jeton réellement sensible ne figure ici : la détection par empreinte est
 * vérifiée avec un jeton synthétique injecté par variable d'environnement.
 *
 * Usage : node scripts/test-garde-fou.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GARDE_FOU = join(fileURLToPath(new URL('.', import.meta.url)), 'garde-fou.mjs');
const JETON_SYNTHETIQUE = 'ZZTEST99';
const EMPREINTE_SYNTHETIQUE = createHash('sha256').update(JETON_SYNTHETIQUE).digest('hex').slice(0, 16);

// Valeurs de test, choisies pour n'exister dans aucune donnée réelle du projet.
const SEL_TEST = 'sel-de-test-sans-valeur-en-production';
const MONTANT_TEST = '987654';
const MASSE_TEST = '777';
const MASSE_PUBLIEE = '4242';

const hmacTest = (espace, valeur) =>
  createHmac('sha256', SEL_TEST).update(`${espace}:${valeur}`).digest('hex').slice(0, 16);

/**
 * Liste d'empreintes telle que la produirait le dépôt privé. Chaque entrée porte
 * la date à laquelle la valeur est devenue privée — c'est elle qui permet au
 * contrôle d'historique de distinguer une fuite d'une publication déjà faite.
 */
function listeEmpreintes({ depuis = '2026-01-01', assume = false } = {}) {
  return JSON.stringify({
    version_extracteur: 2,
    algorithme: 'HMAC-SHA256, tronqué à 16 caractères hexadécimaux',
    seuils: { monnaie: 100, masse: 20 },
    empreintes: [
      { e: hmacTest('monnaie', MONTANT_TEST), depuis, ...(assume ? { assume: true } : {}) },
      { e: hmacTest('masse', MASSE_TEST), depuis },
    ],
  }, null, 2);
}

/* --------------------------------------------------------------- fabriques */

/** JPEG minimal portant un IFD GPS — reproduit ce qu'écrit un boîtier géolocalisé. */
function jpegAvecGps() {
  const tiff = Buffer.alloc(80);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);

  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10); // GPSInfo
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22);

  tiff.writeUInt16LE(2, 26);
  tiff.writeUInt16LE(0x0001, 28); // GPSLatitudeRef
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(2, 32);
  tiff.write('N\0', 36, 'ascii');
  tiff.writeUInt16LE(0x0002, 40); // GPSLatitude
  tiff.writeUInt16LE(5, 42);
  tiff.writeUInt32LE(3, 44);
  tiff.writeUInt32LE(56, 46);
  tiff.writeUInt32LE(0, 52);
  [[43, 1], [17, 1], [3, 1]].forEach(([n, d], i) => {
    tiff.writeUInt32LE(n, 56 + i * 8);
    tiff.writeUInt32LE(d, 60 + i * 8);
  });

  const entete = Buffer.from('Exif\0\0', 'ascii');
  const longueur = Buffer.alloc(2);
  longueur.writeUInt16BE(entete.length + tiff.length + 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1]), longueur, entete, tiff,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** JPEG sans aucune métadonnée — ce que doit produire le pipeline d'images. */
function jpegPropre() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
}

function lancerGardeFou(racine, { sel = SEL_TEST } = {}) {
  const env = { ...process.env, GARDE_FOU_EMPREINTES_SUP: `${EMPREINTE_SYNTHETIQUE}:jeton de test` };
  if (sel === null) delete env.GARDE_FOU_SEL; else env.GARDE_FOU_SEL = sel;
  return spawnSync(process.execPath, [GARDE_FOU, '--racine', racine], { encoding: 'utf8', env });
}

/* ------------------------------------------------------------------- cas 1 */

const fautif = mkdtempSync(join(tmpdir(), 'garde-fou-fautif-'));
mkdirSync(join(fautif, 'docs'), { recursive: true });
mkdirSync(join(fautif, 'data'), { recursive: true });
mkdirSync(join(fautif, 'media', 'astro'), { recursive: true });

writeFileSync(join(fautif, 'docs', 'note-concession.md'), `# Note de rendez-vous

Configuration retenue : ${JETON_SYNTHETIQUE}, annoncée à 123 456 € TTC hors remise.
Reprise proposée à 12 500 €, à confirmer.

Voir le notaire avant signature — la succession en cours change le montage.
Immatriculation prévisionnelle : AB-123-CD.
`, 'utf8');

writeFileSync(join(fautif, 'data', 'itineraire.geojson'), JSON.stringify({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    // `ordre` et `date_prevue` sont exactement ce que la règle du décalage
    // d'étape ne voit pas : le lieu est passé, mais la séquence dit la suite.
    properties: { nom: 'Bivouac nuit 3', type: 'bivouac', ordre: 3, date_prevue: '2027-01-14' },
    geometry: { type: 'Point', coordinates: [-1.4521837, 43.4832916] },
  }],
}, null, 2), 'utf8');

writeFileSync(join(fautif, 'media', 'astro', 'voie-lactee.jpg'), jpegAvecGps());
writeFileSync(join(fautif, 'docs', 'PASSATION-Claude-Code.md'), '# Passation\n', 'utf8');
writeFileSync(join(fautif, 'media', 'astro', 'brute.arw'), Buffer.alloc(64));
writeFileSync(join(fautif, 'media', 'astro', 'panorama.jpg'), Buffer.concat([jpegPropre(), Buffer.alloc(3 * 1024 * 1024)]));

// Valeurs littérales recopiées depuis le privé, telles qu'une note rédigée à la
// main les ferait apparaître. La masse publiée par l'export doit, elle, passer.
writeFileSync(join(fautif, 'data', 'empreintes-interdites.json'), listeEmpreintes(), 'utf8');
mkdirSync(join(fautif, 'data', 'derive'), { recursive: true });
writeFileSync(join(fautif, 'data', 'derive', 'poids-categories.json'),
  JSON.stringify({ categories: [{ categorie: 'essai', kg: Number(MASSE_PUBLIEE) }] }, null, 2), 'utf8');
writeFileSync(join(fautif, 'docs', 'brouillon.md'),
  `# Brouillon\n\nLe pack est facturé ${MONTANT_TEST} EUR.\n` +
  `L'ensemble pèse ${MASSE_TEST} kg.\n` +
  `La catégorie publiée vaut ${MASSE_PUBLIEE} kg et doit passer.\n`, 'utf8');

const ATTENDUS = [
  ['valeur-privee', 'valeur littérale existant dans les données privées'],
  ['jeton-sensible', 'numéro de configuration détecté par empreinte'],
  ['montant-euro', 'montant en euros'],
  ['administratif', 'vocabulaire administratif privé'],
  ['immatriculation', 'plaque d\'immatriculation'],
  ['coordonnees-trop-precises', 'coordonnée GeoJSON à plus de 3 décimales'],
  ['geojson-sequence', 'attribut de date ou d\'ordre dans un GeoJSON public'],
  ['exif-gps', 'position GPS dans les métadonnées EXIF'],
  ['fichier-interdit', 'fichier source ou lourd interdit de publication'],
  ['fichier-trop-lourd', 'dérivé dépassant le plafond de 2 Mo'],
];

const r1 = lancerGardeFou(fautif);
const sortie1 = r1.stdout + r1.stderr;

console.log(`Cas fautif — ${ATTENDUS.length} règles doivent mordre :\n`);
let echecs = 0;

for (const [regle, libelle] of ATTENDUS) {
  const detectee = sortie1.includes(`[${regle}]`);
  console.log(`  ${detectee ? '✓' : '✗'}  ${regle.padEnd(26)} ${libelle}`);
  if (!detectee) echecs++;
}

if (r1.status !== 1) {
  console.log(`\n  ✗  code de sortie ${r1.status} au lieu de 1`);
  echecs++;
} else {
  console.log('\n  ✓  code de sortie 1 — publication refusée');
}

if (sortie1.includes(JETON_SYNTHETIQUE)) {
  console.log('  ✗  le jeton détecté est réaffiché en clair dans le rapport');
  echecs++;
} else {
  console.log('  ✓  le jeton détecté est masqué dans le rapport');
}

// Une valeur que l'export a publiée sciemment doit traverser sans bruit :
// c'est cette discrimination qui rend la règle utilisable au quotidien.
if (sortie1.includes(`${MASSE_PUBLIEE} kg`)) {
  console.log('  ✗  faux positif sur une valeur publiée par l\'export');
  echecs++;
} else {
  console.log('  ✓  la valeur publiée par l\'export n\'est pas signalée');
}

rmSync(fautif, { recursive: true, force: true });

/* ------------------------------------------------- cas 1 bis : sel manquant */

const sansSel = mkdtempSync(join(tmpdir(), 'garde-fou-sans-sel-'));
mkdirSync(join(sansSel, 'data'), { recursive: true });
writeFileSync(join(sansSel, 'data', 'empreintes-interdites.json'), listeEmpreintes(), 'utf8');

const r1b = lancerGardeFou(sansSel, { sel: null });
console.log('\nSel absent — le contrôle doit échouer, pas passer :\n');
if (r1b.status === 1 && /sel HMAC est introuvable/i.test(r1b.stdout + r1b.stderr)) {
  console.log('  ✓  échec fermé : un contrôle impossible n\'est pas un contrôle réussi');
} else {
  console.log(`  ✗  code ${r1b.status} — le garde-fou a laissé passer sans pouvoir vérifier`);
  echecs++;
}
rmSync(sansSel, { recursive: true, force: true });

/* ------------------------------------------------------------------- cas 2 */

const propre = mkdtempSync(join(tmpdir(), 'garde-fou-propre-'));
mkdirSync(join(propre, 'data', 'derive'), { recursive: true });
mkdirSync(join(propre, 'media', 'astro'), { recursive: true });

writeFileSync(join(propre, 'data', 'empreintes-interdites.json'), listeEmpreintes(), 'utf8');
writeFileSync(join(propre, 'data', 'derive', 'poids-categories.json'),
  JSON.stringify({ categories: [{ categorie: 'energie', kg: 189 }] }, null, 2), 'utf8');

// Régression : un entier de quatre chiffres est aussi une année, un numéro de
// version ou un fragment d'URL. L'espace de noms SVG a déjà fait remonter une
// ligne du budget privé. Ces trois formes doivent traverser sans bruit.
writeFileSync(join(propre, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/${MONTANT_TEST}/svg" viewBox="0 0 32 32"><path d="M2 19h27z"/></svg>`, 'utf8');
writeFileSync(join(propre, 'notes.md'),
  `Publié le ${MONTANT_TEST.slice(0, 4)}-01-14.\n` +
  `Référence : https://exemple.org/dossier/${MONTANT_TEST}/piece\n`, 'utf8');
writeFileSync(join(propre, 'data', 'itineraire-public.geojson'), JSON.stringify({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { nom: 'Étape — côte basque', publie: true },
    geometry: { type: 'Point', coordinates: [-1.452, 43.483] },
  }],
}, null, 2), 'utf8');
writeFileSync(join(propre, 'media', 'astro', 'voie-lactee.jpg'), jpegPropre());

const r2 = lancerGardeFou(propre);
console.log('\nCas propre — rien ne doit mordre :\n');
if (r2.status === 0) {
  console.log('  ✓  code de sortie 0 — dépôt publiable');
} else {
  console.log(`  ✗  code de sortie ${r2.status}, faux positif :\n${r2.stdout}${r2.stderr}`);
  echecs++;
}

rmSync(propre, { recursive: true, force: true });

/* ------------------------------------------------------------------ verdict */

if (echecs > 0) {
  console.error(`\n${echecs} contrôle(s) en échec. Le garde-fou n'est pas fiable en l'état.\n`);
  process.exit(1);
}
console.log(`\nGarde-fou vérifié : il mord sur les ${ATTENDUS.length} règles, échoue fermé sans sel, ` +
  'et laisse passer un dépôt propre.\n');
