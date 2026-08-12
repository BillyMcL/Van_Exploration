#!/usr/bin/env node
/**
 * Garde-fou anti-fuite du dépôt public.
 *
 * Le dépôt privé produit des agrégats via son script d'export. Ce garde-fou ne
 * fait pas confiance à cet export : il relit l'intégralité du dépôt public et
 * refuse tout ce qui ressemble à une donnée qui n'aurait jamais dû sortir.
 *
 * Il existe parce qu'un jour quelqu'un copiera un fichier à la main.
 *
 * CE QUI N'EST PAS COUVERT — à lire avant de s'y fier
 *
 * Le contrôle des valeurs littérales s'arrête en dessous de 100 € et de 20 kg.
 * En dessous de ces magnitudes, une valeur est trop banale pour être distinguée
 * du bruit : la contrôler produirait assez de faux positifs pour que quelqu'un
 * finisse par désactiver la règle. Ces petites valeurs ne sont donc PAS
 * protégées par les empreintes. Ne pas croire le contraire en relisant ce
 * fichier dans six mois : une masse de 9 kg ou un montant de 50 € recopiés à la
 * main depuis le dépôt privé passeront sans être signalés.
 *
 * Ce qui les couvre encore : l'interdiction des fichiers sources, la règle des
 * montants en euros (qui attrape toute écriture avec le symbole), et la revue
 * humaine. Rien d'autre.
 *
 * Usage :
 *   node scripts/garde-fou.mjs            vérifie le dépôt
 *   node scripts/garde-fou.mjs --verbose  détaille les fichiers inspectés
 *
 * Sortie : code 0 si le dépôt est propre, 1 sinon.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac } from 'node:crypto';

const iRacine = process.argv.indexOf('--racine');
const RACINE = iRacine !== -1
  ? process.argv[iRacine + 1]
  : join(fileURLToPath(new URL('.', import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

/**
 * Deux fichiers sont exclus de la recherche de motifs en clair : le garde-fou
 * lui-même et son test. Ils énoncent le vocabulaire qu'ils interdisent
 * (« notaire », « succession »…) et se signaleraient à chaque passage.
 *
 * L'exception ne couvre que les motifs en clair. Les empreintes, les noms de
 * fichiers, les tailles et l'EXIF leur restent appliqués — un vrai jeton
 * sensible glissé dans l'un de ces deux fichiers serait donc quand même
 * détecté. L'exclusion n'ouvre pas de trou.
 */
const EXCLUS_DES_MOTIFS = new Set([
  join('scripts', 'garde-fou.mjs'),
  join('scripts', 'test-garde-fou.mjs'),
]);

// `.github` n'est volontairement pas ignoré : un workflow est un fichier comme
// un autre, et rien n'empêche d'y coller une valeur qui n'aurait pas dû sortir.
const IGNORE_DOSSIERS = new Set(['.git', 'node_modules', 'dist', '.astro']);

const TAILLE_MAX_MEDIA = 2 * 1024 * 1024; // 2 Mo — le site ne sert que des dérivés
const TAILLE_MAX_AUTRE = 5 * 1024 * 1024;

const EXT_TEXTE = new Set([
  '.md', '.mdx', '.json', '.geojson', '.csv', '.txt', '.html', '.htm',
  '.js', '.mjs', '.ts', '.astro', '.css', '.yml', '.yaml', '.svg',
]);
const EXT_IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.heic']);

/* ------------------------------------------------------------------ règles */

/**
 * Jetons sensibles, stockés par empreinte et non en clair.
 *
 * Écrire les numéros de configuration dans ce fichier reviendrait à les publier :
 * ce script vit dans le dépôt public. Le premier passage du garde-fou l'a d'ailleurs
 * signalé lui-même. On compare donc des empreintes SHA-256 tronquées, ce qui permet
 * de détecter un jeton sans jamais le contenir.
 */
const EMPREINTES_INTERDITES = new Map([
  ['c910cfc28bcea585', 'numéro de configuration Hymer (configuration retenue)'],
  ['e67a8cd5fd26e898', 'numéro de configuration Hymer (configuration écartée)'],
  ['6c809360892c2e62', 'numéro de configuration Hymer (configuration écartée)'],
]);

// Empreintes supplémentaires injectées par le test, au format « empreinte:libellé ».
// Permet de vérifier le mécanisme sans qu'aucun jeton réel figure dans le test.
for (const paire of (process.env.GARDE_FOU_EMPREINTES_SUP ?? '').split(',').filter(Boolean)) {
  const [empreinte, ...reste] = paire.split(':');
  EMPREINTES_INTERDITES.set(empreinte, reste.join(':') || 'jeton de test');
}

/* ------------------------------------------- valeurs littérales du privé
 *
 * Aucune valeur présente dans les données privées ne doit se retrouver ici,
 * sauf celles que l'export a publiées par une décision explicite. Le dépôt privé
 * génère la liste, sous forme de HMAC : un simple hachage de « 160600 » se casse
 * par énumération en quelques millisecondes et reviendrait à publier le montant.
 *
 * Sans le sel, le contrôle ne peut pas s'exécuter — et dans ce cas il échoue au
 * lieu de passer. Un contrôle qu'on ne peut pas faire n'est pas un contrôle réussi.
 */
const CHEMIN_EMPREINTES = join(RACINE, 'data', 'empreintes-interdites.json');
const VERSION_EXTRACTEUR = 1;

let listeLitterales = null;
let selHmac = process.env.GARDE_FOU_SEL ?? null;

if (existsSync(CHEMIN_EMPREINTES)) {
  listeLitterales = JSON.parse(readFileSync(CHEMIN_EMPREINTES, 'utf8'));

  // Confort de développement local : les deux dépôts sont côte à côte.
  if (!selHmac) {
    const selVoisin = join(RACINE, '..', 'Van_Exploration-prive', 'export', '.sel');
    if (existsSync(selVoisin)) selHmac = readFileSync(selVoisin, 'utf8').trim();
  }

  if (!selHmac) {
    console.error('\nLe sel HMAC est introuvable : ni GARDE_FOU_SEL, ni le dépôt privé voisin.');
    console.error('Le contrôle des valeurs littérales ne peut pas s\'exécuter, donc rien n\'est publié.');
    console.error('En CI, déclarer le secret GARDE_FOU_SEL du dépôt.\n');
    process.exit(1);
  }

  if (listeLitterales.version_extracteur !== VERSION_EXTRACTEUR) {
    console.error(`\nVersion d'extracteur incompatible : la liste est en v${listeLitterales.version_extracteur}, ` +
      `ce garde-fou en v${VERSION_EXTRACTEUR}.`);
    console.error('Les candidats ne seraient pas extraits de la même façon des deux côtés.');
    console.error('Régénérer la liste depuis le dépôt privé : node export/empreintes.mjs\n');
    process.exit(1);
  }
}

const ENSEMBLE_LITTERALES = new Set(listeLitterales?.empreintes ?? []);

/** Motifs interdits dans tout fichier texte du dépôt public. */
const MOTIFS = [
  {
    id: 'montant-euro',
    libelle: 'montant en euros',
    // 4 chiffres et plus, séparateurs de milliers usuels compris (espace fine incluse)
    regex: /(?:\d[\d    .]{3,}\d\s*(?:€|EUR\b)|(?:€|EUR\s)\s*\d[\d    .]{3,}\d)/g,
    pourquoi: 'Aucun montant absolu ne sort du dépôt privé. Le budget se publie en pourcentages.',
  },
  {
    id: 'montant-keuro',
    libelle: 'montant abrégé en milliers d\'euros',
    regex: /\b\d{1,4}\s*k\s*€/gi,
    pourquoi: 'Un montant reste un montant même abrégé.',
  },
  {
    id: 'iban',
    libelle: 'IBAN',
    regex: /\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){2,7}[A-Z0-9]{1,4}\b/g,
    pourquoi: 'Coordonnées bancaires.',
  },
  {
    id: 'administratif',
    libelle: 'référence à un document administratif privé',
    regex: /\b(?:notaire|succession|procuration|acte de vente|carte grise|certificat d'immatriculation)\b/gi,
    pourquoi: 'Documents administratifs confidentiels (§10 de la passation).',
  },
  {
    id: 'immatriculation',
    libelle: 'plaque d\'immatriculation',
    regex: /\b[A-Z]{2}-\d{3}-[A-Z]{2}\b/g,
    pourquoi: 'Identifie le véhicule et permet de le suivre.',
  },
];

/** Fichiers qui ne doivent jamais exister dans le dépôt public, quel que soit leur contenu. */
const FICHIERS_INTERDITS = [
  { regex: /PASSATION/i, pourquoi: 'Document de passation — contient budgets, configuration et données administratives.' },
  { regex: /^Mon-Hymer-/i, pourquoi: 'PDF de configuration constructeur.' },
  { regex: /^(?:budget|materiel|poids)\.csv$/i, pourquoi: 'Fichier source du dépôt privé. Seuls les agrégats de data/derive/ sont publiables.' },
  { regex: /^(?:vehicule-config|masses|hypotheses|energie-systeme)\.json$/i, pourquoi: 'Fichier source du dépôt privé.' },
  { regex: /^(?:prospectif|stationnements)\.geojson$/i, pourquoi: 'Itinéraire prospectif ou stationnements nocturnes — jamais publiables.' },
  { regex: /\.(?:qgz|qgs|gpkg)$/i, pourquoi: 'Projet QGIS — reste dans le dépôt privé.' },
  { regex: /\.(?:arw|cr2|cr3|nef|dng|las|laz|e57)$/i, pourquoi: 'Fichier lourd de production. Stockage externe référencé par manifeste.' },
];

/* ------------------------------------------------------------------- outils */

const violations = [];

function signaler(fichier, regle, detail, extrait) {
  violations.push({ fichier, regle, detail, extrait });
}

function* parcourir(dossier) {
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (entree.isDirectory()) {
      if (IGNORE_DOSSIERS.has(entree.name)) continue;
      yield* parcourir(join(dossier, entree.name));
    } else if (entree.isFile()) {
      yield join(dossier, entree.name);
    }
  }
}

/** Numéro de ligne d'un index de caractère, pour pointer la violation. */
function ligneDe(texte, index) {
  return texte.slice(0, index).split('\n').length;
}

/* ------------------------------------------------------- contrôles unitaires */

function controlerNom(chemin, rel) {
  const nom = basename(chemin);
  for (const { regex, pourquoi } of FICHIERS_INTERDITS) {
    if (regex.test(nom)) signaler(rel, 'fichier-interdit', pourquoi, nom);
  }
}

function controlerTaille(chemin, rel) {
  const taille = statSync(chemin).size;
  const dansMedia = rel.split(sep)[0] === 'media';
  const max = dansMedia ? TAILLE_MAX_MEDIA : TAILLE_MAX_AUTRE;
  if (taille > max) {
    signaler(rel, 'fichier-trop-lourd',
      `${(taille / 1024 / 1024).toFixed(1)} Mo pour un plafond de ${(max / 1024 / 1024).toFixed(0)} Mo. ` +
      'Le dépôt public ne contient que des dérivés web ; les originaux vivent en stockage externe.',
      `${(taille / 1024 / 1024).toFixed(1)} Mo`);
  }
}

function controlerMotifs(rel, texte) {
  for (const motif of MOTIFS) {
    motif.regex.lastIndex = 0;
    let m;
    while ((m = motif.regex.exec(texte)) !== null) {
      signaler(rel, motif.id, `${motif.libelle} — ${motif.pourquoi}`,
        `ligne ${ligneDe(texte, m.index)} : ${m[0].trim()}`);
      if (m[0].length === 0) motif.regex.lastIndex++;
    }
  }
}

/**
 * Détection par empreinte : chaque jeton alphanumérique majuscule du texte est
 * haché et comparé à la liste. Permet de reconnaître une donnée sensible sans
 * que ce fichier ait à la contenir.
 */
function controlerEmpreintes(rel, texte) {
  const regex = /\b[A-Z0-9]{6,12}\b/g;
  let m;
  while ((m = regex.exec(texte)) !== null) {
    const empreinte = createHash('sha256').update(m[0]).digest('hex').slice(0, 16);
    const libelle = EMPREINTES_INTERDITES.get(empreinte);
    if (libelle) {
      signaler(rel, 'jeton-sensible', `${libelle} — donnée commerciale personnelle qui ne sort jamais du dépôt privé.`,
        `ligne ${ligneDe(texte, m.index)} : ${m[0].slice(0, 2)}…${m[0].slice(-2)}`);
    }
  }
}

/**
 * Contrôle des valeurs littérales privées.
 *
 * L'extraction est contextuelle : « 189 » seul n'est pas un candidat, « 189 kg »
 * en est un. Sans ce contexte, les nombres courants déclencheraient assez de
 * faux positifs pour que quelqu'un finisse par désactiver le contrôle — et un
 * garde-fou désactivé protège moins qu'un garde-fou absent, parce qu'on croit
 * encore l'avoir.
 *
 * Toute évolution de ces motifs impose d'incrémenter VERSION_EXTRACTEUR ici et
 * dans export/empreintes.mjs : les deux côtés doivent extraire à l'identique.
 */
/**
 * Le nombre nu attrape un montant écrit sans symbole — « le véhicule coûte
 * 160600 ». Mais un entier de quatre chiffres est aussi une année, un numéro de
 * version ou un fragment d'URL : l'espace de noms SVG `.../2000/svg` a fait
 * remonter la provision d'imprévus du budget privé. On neutralise donc les URL
 * et les dates avant cette passe-là, et elle seule : les passes contextuelles
 * n'en ont pas besoin et ne doivent rien perdre.
 */
const sansUrlNiDate = (texte) =>
  texte
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, (m) => ' '.repeat(m.length))
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+)?/g, (m) => ' '.repeat(m.length));

const EXTRACTEURS = [
  { espace: 'monnaie', regex: /(\d[\d   .,]*\d|\d)\s*(?:€|EUR\b)/g, libelle: 'montant' },
  { espace: 'monnaie', regex: /(?<![\d.,])(\d{4,})(?![\d.,])/g, libelle: 'montant', pretraitement: sansUrlNiDate },
  { espace: 'masse', regex: /(\d[\d   .,]*\d|\d)\s*(?:kg|kilos?)\b/gi, libelle: 'masse détaillée' },
  { espace: 'coord', regex: /(-?\d+\.\d{3,})/g, libelle: 'coordonnée' },
  { espace: 'jeton', regex: /\b([A-Z0-9]{6,12})\b/g, libelle: 'identifiant', pretraitement: sansUrlNiDate },
];

const normaliser = (brut) => String(brut).replace(/[\s   ]/g, '').replace(',', '.').replace(/\.0+$/, '');

function controlerLitterales(rel, texte) {
  if (!ENSEMBLE_LITTERALES.size) return;
  const seuils = listeLitterales.seuils ?? {};

  for (const { espace, regex, libelle, pretraitement } of EXTRACTEURS) {
    // Le prétraitement remplace par des espaces, jamais par une chaîne plus
    // courte : les positions sont conservées, donc les numéros de ligne aussi.
    const source = pretraitement ? pretraitement(texte) : texte;
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(source)) !== null) {
      const valeur = normaliser(m[1]);
      if (valeur === '' || valeur === '0') continue;
      const seuil = seuils[espace];
      if (seuil !== undefined && Math.abs(Number(valeur)) < seuil) continue;

      const emp = createHmac('sha256', selHmac).update(`${espace}:${valeur}`).digest('hex').slice(0, 16);
      if (ENSEMBLE_LITTERALES.has(emp)) {
        signaler(rel, 'valeur-privee',
          `${libelle} présent dans les données privées et non publié par l'export. ` +
          'Soit la valeur n\'a rien à faire ici, soit elle doit passer par le contrat d\'export pour être publiée sciemment.',
          `ligne ${ligneDe(source, m.index)} : ${m[0].trim()}`);
      }
    }
  }
}

/**
 * Attributs de date, d'ordre ou de séquence dans un GeoJSON public.
 *
 * La règle du décalage d'une étape protège contre la publication d'un lieu où
 * l'on est encore. Elle ne protège pas contre un `ordre: 3` glissé dans les
 * propriétés : un ordre implique une séquence, une séquence implique un
 * calendrier, et un calendrier dit où sera le véhicule. C'est le même
 * renseignement par un autre chemin.
 */
const CLES_DATE = /(^|_)(date|dates|jour|heure|horaire|timestamp|debut|fin|depart|arrivee|prevu|prevue|planning)($|_)/i;
const CLES_ORDRE = /(^|_)(ordre|order|sequence|seq|rang|rank|index|etape|step|numero|num|position|suivant|suivante|prochain|prochaine)($|_)/i;
const VALEUR_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

function controlerGeojsonSequence(rel, texte) {
  let arbre;
  try {
    arbre = JSON.parse(texte);
  } catch {
    signaler(rel, 'geojson-illisible', 'GeoJSON non analysable. Un fichier dont on ne sait pas lire les propriétés ne se publie pas.', 'JSON invalide');
    return;
  }

  const vu = new Set();
  (function parcourirValeur(noeud, chemin) {
    if (Array.isArray(noeud)) return noeud.forEach((v, i) => parcourirValeur(v, `${chemin}[${i}]`));
    if (noeud === null || typeof noeud !== 'object') {
      if (typeof noeud === 'string' && VALEUR_DATE.test(noeud) && !vu.has(`v${chemin}`)) {
        vu.add(`v${chemin}`);
        signaler(rel, 'geojson-sequence',
          'Date présente dans les propriétés. L\'itinéraire ne se publie qu\'en rétrospective et sans calendrier.',
          `${chemin} : ${noeud}`);
      }
      return;
    }
    for (const [cle, valeur] of Object.entries(noeud)) {
      const type = CLES_DATE.test(cle) ? 'date' : CLES_ORDRE.test(cle) ? 'ordre' : null;
      if (type && !vu.has(cle)) {
        vu.add(cle);
        signaler(rel, 'geojson-sequence',
          type === 'date'
            ? 'Attribut de date dans un GeoJSON public. L\'itinéraire ne se publie qu\'en rétrospective.'
            : 'Attribut d\'ordre ou de séquence. Un ordre implique un calendrier, et un calendrier dit où sera le véhicule.',
          `propriété « ${cle} »`);
      }
      parcourirValeur(valeur, `${chemin}.${cle}`);
    }
  })(arbre, '');
}

/** Coordonnées trop précises : au-delà de 3 décimales on situe un véhicule à moins de 100 m. */
function controlerCoordonnees(rel, texte) {
  const regex = /-?\d+\.\d{4,}/g;
  let m;
  while ((m = regex.exec(texte)) !== null) {
    signaler(rel, 'coordonnees-trop-precises',
      'Coordonnée à plus de 3 décimales. La règle d\'export arrondit à 3 décimales et remplace les bivouacs par le centroïde de la commune.',
      `ligne ${ligneDe(texte, m.index)} : ${m[0]}`);
  }
}

/* ------------------------------------------------------------- EXIF / GPS */

/**
 * Cherche un pointeur vers l'IFD GPS (tag 0x8825) dans un bloc TIFF.
 * Retourne true dès qu'il est présent, même si le sous-IFD est vide :
 * sa seule existence signale que l'appareil a écrit une position.
 */
function tiffContientGps(buf, debut) {
  if (debut + 8 > buf.length) return false;
  const ordre = buf.toString('ascii', debut, debut + 2);
  if (ordre !== 'II' && ordre !== 'MM') return false;
  const le = ordre === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  if (u16(debut + 2) !== 42) return false;
  let offsetIfd = u32(debut + 4);

  // On se limite à quelques IFD : IFD0 puis les suivants de la chaîne.
  for (let passe = 0; passe < 4; passe++) {
    const pos = debut + offsetIfd;
    if (pos + 2 > buf.length || offsetIfd === 0) return false;
    const nb = u16(pos);
    if (pos + 2 + nb * 12 + 4 > buf.length) return false;
    for (let i = 0; i < nb; i++) {
      const tag = u16(pos + 2 + i * 12);
      if (tag === 0x8825) return true; // GPSInfo IFD pointer
    }
    offsetIfd = u32(pos + 2 + nb * 12);
  }
  return false;
}

function controlerExif(chemin, rel) {
  const buf = readFileSync(chemin);

  // JPEG : parcours des segments APP à la recherche d'un APP1 « Exif\0\0 »
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= buf.length) {
      if (buf[i] !== 0xff) break;
      const marqueur = buf[i + 1];
      if (marqueur === 0xd8 || marqueur === 0xd9) { i += 2; continue; }
      if (marqueur === 0xda) break; // début des données image
      const taille = buf.readUInt16BE(i + 2);
      const debutCharge = i + 4;
      const charge = buf.subarray(debutCharge, debutCharge + taille - 2);

      if (marqueur === 0xe1) {
        if (charge.subarray(0, 6).toString('ascii') === 'Exif\0\0') {
          if (tiffContientGps(buf, debutCharge + 6)) {
            signaler(rel, 'exif-gps', 'Métadonnée EXIF GPS présente. ' +
              'Chaque photo d\'astrophotographie porte les coordonnées du lieu de bivouac.', 'IFD GPS (0x8825)');
            return;
          }
        }
        const xmp = charge.toString('latin1');
        if (/GPSLatitude|GPSLongitude|geo:lat/i.test(xmp)) {
          signaler(rel, 'exif-gps', 'Position présente dans les métadonnées XMP.', 'XMP GPS');
          return;
        }
      }
      i = debutCharge + taille - 2;
    }
  }

  // PNG : chunk eXIf
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) {
    const idx = buf.indexOf('eXIf', 0, 'ascii');
    if (idx > 0 && tiffContientGps(buf, idx + 4)) {
      signaler(rel, 'exif-gps', 'Chunk eXIf contenant une position.', 'eXIf GPS');
      return;
    }
  }

  // WebP : chunk EXIF
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const idx = buf.indexOf('EXIF', 12, 'ascii');
    if (idx > 0 && tiffContientGps(buf, idx + 8)) {
      signaler(rel, 'exif-gps', 'Chunk EXIF contenant une position.', 'EXIF GPS');
    }
  }
}

/* --------------------------------------------------------------- exécution */

let inspectes = 0;

for (const chemin of parcourir(RACINE)) {
  const rel = relative(RACINE, chemin);
  const ext = extname(chemin).toLowerCase();
  inspectes++;
  if (VERBOSE) console.log(`  · ${rel}`);

  controlerNom(chemin, rel);
  controlerTaille(chemin, rel);

  if (EXT_TEXTE.has(ext)) {
    const texte = readFileSync(chemin, 'utf8');
    controlerEmpreintes(rel, texte);
    if (!EXCLUS_DES_MOTIFS.has(rel)) {
      controlerMotifs(rel, texte);
      controlerLitterales(rel, texte);
    }
    if (ext === '.geojson') {
      controlerCoordonnees(rel, texte);
      controlerGeojsonSequence(rel, texte);
    }
  } else if (EXT_IMAGE.has(ext)) {
    try {
      controlerExif(chemin, rel);
    } catch (e) {
      signaler(rel, 'exif-illisible', `Image non analysable (${e.message}). Un fichier dont on ne sait pas lire les métadonnées ne se publie pas.`, ext);
    }
  }
}

/* ------------------------------------------------------------------ rapport */

console.log(`\nGarde-fou — ${inspectes} fichiers inspectés.`);

if (violations.length === 0) {
  console.log('Aucune fuite détectée. Le dépôt est publiable.\n');
  process.exit(0);
}

const parFichier = new Map();
for (const v of violations) {
  if (!parFichier.has(v.fichier)) parFichier.set(v.fichier, []);
  parFichier.get(v.fichier).push(v);
}

console.error(`\n${violations.length} violation(s) dans ${parFichier.size} fichier(s) :\n`);
for (const [fichier, liste] of parFichier) {
  console.error(`  ${fichier}`);
  for (const v of liste) {
    console.error(`      [${v.regle}] ${v.extrait}`);
    console.error(`      ${v.detail}`);
  }
  console.error('');
}
console.error('Publication refusée. Rien ne part vers GitHub Pages tant que ces points ne sont pas levés.\n');
process.exit(1);
