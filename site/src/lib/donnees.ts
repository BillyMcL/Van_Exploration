/**
 * Chargement et validation des données dérivées.
 *
 * Les fichiers de `data/derive/` sont produits par le dépôt privé. Ce module les
 * lit au build et les valide contre un schéma : un export malformé fait échouer
 * la construction du site au lieu de publier une page fausse.
 *
 * La lecture a lieu au build, pas dans le navigateur. Les chiffres entrent donc
 * dans le HTML par rendu et jamais par saisie — la contrainte « aucun chiffre en
 * dur » est tenue par la mécanique, pas par la discipline. Corollaire : le site
 * fonctionne sans JavaScript, s'indexe et s'imprime.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DERIVE = new URL('../../../data/derive/', import.meta.url);

function charger<T extends z.ZodTypeAny>(fichier: string, schema: T): z.infer<T> {
  const chemin = fileURLToPath(new URL(fichier, DERIVE));
  let brut: unknown;
  try {
    // Le BOM est retiré : un fichier retouché à la main sous Windows en gagne un,
    // et JSON.parse échouerait alors sur une erreur de syntaxe illisible.
    brut = JSON.parse(readFileSync(chemin, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(
      `Donnée dérivée illisible : ${fichier}\n` +
      `  ${(e as Error).message}\n` +
      `  Relancer l'export depuis le dépôt privé : node export/export.mjs`,
    );
  }

  const resultat = schema.safeParse(brut);
  if (!resultat.success) {
    throw new Error(
      `Donnée dérivée invalide : ${fichier}\n` +
      resultat.error.issues.map((i) => `  · ${i.path.join('.') || '(racine)'} — ${i.message}`).join('\n') +
      `\n  Le contrat d'export a probablement changé sans que le site suive.`,
    );
  }
  return resultat.data;
}

/* ------------------------------------------------------------------ schémas */

const manifestSchema = z.object({
  version_contrat: z.number().int().positive(),
  empreinte_sources: z.string().length(16),
  fichiers: z.array(z.string()).nonempty(),
});

const budgetSchema = z.object({
  perimetre: z.string(),
  phases: z.record(
    z.string(),
    z.array(z.object({ categorie: z.string(), part_pct: z.number().min(0).max(100) })).nonempty(),
  ),
});

const poidsSchema = z.object({
  etat_reservoirs: z.string(),
  total_kg: z.number().positive(),
  categories: z.array(z.object({ categorie: z.string(), kg: z.number().nonnegative() })).nonempty(),
});

const configurationsSchema = z.object({
  masse_passager_kg: z.number().positive(),
  ptac_kg: z.number().positive(),
  plafond_exige_kg: z.number().positive(),
  scenario_reference: z.string(),
  // Seuil de lecture, pas de mise en forme : ce qui sépare « serré » de
  // « confortable » est un choix d'exploitation, il vit donc dans les données.
  seuil_marge_serree_kg: z.number().positive(),
  seuil_marge_serree_note: z.string(),
  scenarios: z.array(z.object({
    id: z.string(),
    libelle: z.string(),
    mom_kg: z.number().positive(),
    charge_utile_kg: z.number().positive(),
    hypothese: z.string(),
  })).nonempty(),
  etats_reservoirs: z.array(z.object({ id: z.string(), libelle: z.string(), note: z.string() })).nonempty(),
  lignes: z.array(z.object({
    etat_reservoirs: z.string(),
    configuration: z.string(),
    configuration_libelle: z.string(),
    scenario: z.string(),
    charge_utile_kg: z.number(),
    charge_kg: z.number().positive(),
    marge_kg: z.number(),
    conforme: z.boolean(),
    autonomie_eau_jours: z.string(),
  })).nonempty(),
});

const jalonsSchema = z.object({
  compte: z.object({ fait: z.number(), bloquant: z.number(), total: z.number() }),
  jalons: z.array(z.object({
    id: z.string(),
    jalon: z.string(),
    famille: z.string(),
    statut: z.enum(['fait', 'provisoire', 'bloquant', 'a_faire']),
    note: z.string(),
  })).nonempty(),
});

const reglesSchema = z.object({
  regles: z.array(z.object({ id: z.string(), titre: z.string(), enonce: z.string() })).nonempty(),
});

/**
 * Corpus. L'index complet est privé — il porte le lieu et les dates de chaque
 * série, y compris de celles qu'on n'a pas encore quittées. Ne sortent que les
 * séries explicitement publiées ; les autres ne sont comptées qu'en volume.
 */
const corpusSchema = z.object({
  total: z.object({
    series: z.number().int().nonnegative(),
    fichiers: z.number().int().nonnegative(),
    volume_go: z.number().nonnegative(),
    publiees: z.number().int().nonnegative(),
  }),
  familles: z.array(z.object({
    famille: z.string(),
    series: z.number().int().nonnegative(),
    fichiers: z.number().int().nonnegative(),
    volume_go: z.number().nonnegative(),
    publiees: z.array(z.object({
      serie: z.string(),
      etape: z.string(),
      pays: z.string(),
      legende: z.string(),
      nb_fichiers: z.number().int().nonnegative(),
    })),
  })).nonempty(),
});

const energieSchema = z.object({
  capacite_utile_kwh: z.number().positive(),
  puissance_solaire_wc: z.number().positive(),
  kwh_par_heure_de_route: z.number().positive(),
  scenarios: z.array(z.object({
    id: z.string(),
    saison: z.string(),
    zone: z.string(),
    consommation_kwh_jour: z.object({ min: z.number(), max: z.number() }),
    production_kwh_jour: z.object({ min: z.number(), max: z.number() }),
    postes: z.array(z.object({ poste: z.string(), min: z.number(), max: z.number() })),
  })).nonempty(),
  conclusions: z.array(z.object({ id: z.string(), titre: z.string(), enonce: z.string() })),
});

/* ------------------------------------------------------------------- format */

/**
 * Mise en forme française des nombres : virgule décimale, espace fine insécable
 * pour les milliers. Les données sont stockées au format JSON — point décimal,
 * pas de séparateur — et ne sont mises en forme qu'à l'affichage.
 */
const formateur = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
export const nombre = (n: number) => formateur.format(n);

/**
 * Mesures en mètres : deux décimales, toujours.
 *
 * `nombre()` arrondit à une décimale, ce qui convient à des kilowattheures et
 * pas du tout à un gabarit — 2,98 m s'affichait « 3 m », et 7,39 m « 7,4 m ».
 * Sur une page dont l'objet est de savoir si le véhicule passe sous une barre,
 * arrondir vers le haut une hauteur est le sens de l'erreur qu'il ne faut pas
 * commettre. Le second chiffre n'est pas une précision cosmétique.
 */
const formateurMesure = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const metres = (centimetres: number) => `${formateurMesure.format(centimetres / 100)} m`;

/* ------------------------------------------------------------------ données */

export const manifest = charger('_manifest.json', manifestSchema);
export const budget = charger('budget-repartition.json', budgetSchema);
export const poids = charger('poids-categories.json', poidsSchema);
export const configurations = charger('configurations.json', configurationsSchema);
export const regles = charger('regles-exploitation.json', reglesSchema);
export const jalons = charger('jalons.json', jalonsSchema);
export const energie = charger('energie-scenarios.json', energieSchema);
export const corpus = charger('corpus.json', corpusSchema);

/**
 * Cohérence croisée : le manifeste annonce des fichiers, ils doivent tous être
 * chargés ici. Un export qui gagne une sortie sans que le site la consomme est
 * une donnée publiée que personne ne regarde.
 */
const charges = new Set([
  'budget-repartition.json', 'poids-categories.json', 'jalons.json',
  'configurations.json', 'regles-exploitation.json', 'energie-scenarios.json',
  'itineraire-public.geojson', 'corpus.json',
  'points-interet.geojson', 'patrons.geojson', 'patrons.json',
  // Les entrées de journal ne sont pas un agrégat JSON mais un dossier de
  // Markdown, consommé par la collection de contenu d'Astro.
  'journal/',
]);
const oublies = manifest.fichiers.filter((f) => !charges.has(f));
if (oublies.length) {
  throw new Error(
    `L'export produit des fichiers que le site ne lit pas : ${oublies.join(', ')}\n` +
    `  Soit les consommer, soit les retirer du contrat d'export.`,
  );
}

/* ----------------------------------------------------------- pays traversés
 *
 * CONTRAINTE DE FORME, VOLONTAIREMENT IMPOSÉE PAR LE SCHÉMA
 *
 * Le tracé ne doit pas être une polyligne. Une ligne qui relie la France à
 * l'Espagne puis au Portugal est un planning déguisé : l'ordre implique les
 * dates, et les dates disent où sera le véhicule. Le §10 du dossier n'autorise
 * l'itinéraire qu'en rétrospective.
 *
 * Le schéma refuse donc toute géométrie autre que Point, et `.strict()` sur les
 * propriétés fait échouer le build si quelqu'un ajoute un `ordre`, une `date` ou
 * un `numero`. La contrainte n'est pas une convention de rédaction : elle est
 * dans le code, et elle casse la construction du site si on l'enfreint.
 */
const paysTraversesSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    properties: z.object({ pays: z.string().min(1), code: z.string().length(2) }).strict(),
    geometry: z.object({
      type: z.literal('Point', {
        errorMap: () => ({ message: 'seules des géométries Point sont admises — une LineString serait un ordre de passage' }),
      }),
      coordinates: z.tuple([z.number(), z.number()]),
    }),
  })).nonempty(),
}).passthrough();

export const paysTraverses = charger('../pays-traverses.geojson', paysTraversesSchema);

/* --------------------------------------------- itinéraire, en rétrospective
 *
 * Produit par l'export du dépôt privé, qui n'y fait entrer une entité qu'une
 * fois qu'on l'a quittée. Le fichier est légitimement vide tant que rien n'a été
 * parcouru : `nonempty()` serait ici un contresens, un itinéraire rétrospectif
 * commence forcément par ne rien contenir.
 *
 * Les mêmes contraintes de forme que pour les pays traversés, pour les mêmes
 * raisons, et deux de plus qui tiennent à ce que ce fichier-ci se remplit dans
 * le temps : le rangement alphabétique, sans quoi l'ordre des entités
 * restituerait la séquence du voyage, et le plafond de trois décimales, qui est
 * la précision de publication convenue.
 */
const itineraireSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    properties: z.object({
      nom: z.string().min(1),
      categorie: z.enum(['ancrage', 'transit', 'site']),
      pays: z.string().length(2),
      pratiques: z.array(z.string()),
    }).strict(),
    geometry: z.object({
      type: z.literal('Point', {
        errorMap: () => ({ message: 'seules des géométries Point sont admises — une LineString serait un ordre de passage' }),
      }),
      coordinates: z.tuple([z.number(), z.number()]),
    }),
  })),
}).passthrough();

export const itineraire = charger('itineraire-public.geojson', itineraireSchema);

{
  const noms = itineraire.features.map((f) => f.properties.nom);
  const tries = [...noms].sort((a, b) => a.localeCompare(b, 'fr'));
  if (noms.join('|') !== tries.join('|')) {
    throw new Error(
      `itineraire-public.geojson n'est pas rangé par ordre alphabétique.\n` +
      `  Un fichier rempli au fil du voyage porterait la séquence dans l'ordre de ses entités.\n` +
      `  Relancer l'export : node export/export.mjs depuis le dépôt privé.`,
    );
  }

  for (const f of itineraire.features) {
    for (const v of f.geometry.coordinates) {
      if ((String(v).split('.')[1]?.length ?? 0) > 3) {
        throw new Error(
          `Coordonnée à plus de 3 décimales dans itineraire-public.geojson : ${v}\n` +
          `  L'export arrondit à 3 décimales, soit environ 100 m. Une valeur plus précise\n` +
          `  n'a pas pu passer par lui.`,
        );
      }
    }
  }
}

/* ------------------------------------------------- spécifications et capacités
 *
 * Saisies directement dans le dépôt public : elles ne dérivent d'aucune donnée
 * privée. Les spécifications sont génériques — dimensions, PTAC, capacités — et
 * ne portent ni configuration commerciale, ni prix, ni option retenue.
 */
export const vehicule = charger('../vehicule-specs.json', z.object({
  modele: z.string(),
  statut_choix: z.string(),
  statut_note: z.string(),
  // Volontairement à la racine et non dans `dimensions`, qui n'accepte que des
  // nombres : la note dit pourquoi la hauteur hors tout reste une enveloppe de
  // planification tant que la galerie seule n'est pas mesurée.
  _hauteur_note: z.string().optional(),
  dimensions: z.record(z.string(), z.number()),
  base: z.object({ chassis: z.string(), puissance_ch: z.number(), puissance_kw: z.number(), norme: z.string() }),
  masses: z.object({ ptac_kg: z.number(), masse_ordre_marche_declaree_kg: z.number(), tolerance_legale_pct: z.number(), charge_soute_kg: z.number(), note: z.string() }),
  soute: z.object({ trappe_largeur_cm: z.number(), trappe_hauteur_cm: z.number(), note: z.string() }),
  capacites: z.record(z.string(), z.number()),
  isolation_mm: z.record(z.string(), z.number()),
  amenagement: z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string())])),
  exploitation: z.object({ classe_peage: z.number(), vitesse_max_autoroute_kmh: z.number(), vitesse_max_route_kmh: z.number(), note: z.string() }),
}).passthrough());

export const capacites = charger('../capacites.json', z.object({
  capacites: z.array(z.object({
    id: z.string(), titre: z.string(), resume: z.string(), contrainte: z.string(),
  })).nonempty(),
}).passthrough());

/**
 * L'ordre du tableau est lui-même une information. On impose l'ordre
 * alphabétique pour qu'aucun ordre de passage ne puisse s'en déduire.
 */
{
  const noms = paysTraverses.features.map((f) => f.properties.pays);
  const tries = [...noms].sort((a, b) => a.localeCompare(b, 'fr'));
  if (noms.join('|') !== tries.join('|')) {
    throw new Error(
      `pays-traverses.geojson n'est pas rangé par ordre alphabétique.\n` +
      `  L'ordre du fichier laisserait deviner un ordre de passage.\n` +
      `  Attendu : ${tries.join(', ')}`,
    );
  }
}

/* ------------------------------------------------------- identité du projet */

const projetSchema = z.object({
  nom: z.string(),
  titulaire_droits: z.string().min(1),
  annee_copyright: z.number().int(),
  licence_code: z.string(),
  licence_contenu: z.string(),
  licence_contenu_url: z.string().url(),
  depot_public: z.string().url(),
});

/** Source unique de la mention de copyright. Le site ne la réécrit jamais. */
export const projet = charger('../projet.json', projetSchema);

/**
 * La licence MIT doit porter la mention en toutes lettres — c'est un texte
 * juridique, il ne se génère pas. On vérifie donc qu'elle n'a pas divergé de la
 * source : passer au nom civil se fait en deux endroits, et le build refuse
 * qu'on n'en change qu'un.
 */
{
  const licence = readFileSync(fileURLToPath(new URL('../../../LICENSE', import.meta.url)), 'utf8');
  const attendu = `Copyright (c) ${projet.annee_copyright} ${projet.titulaire_droits}`;
  if (!licence.includes(attendu)) {
    throw new Error(
      `LICENSE a divergé de data/projet.json.\n` +
      `  Attendu : « ${attendu} »\n` +
      `  Le titulaire des droits se change à deux endroits, pas un.`,
    );
  }
}

/* ------------------------------------------- points d'intérêt et patrons
 *
 * Le vivier de destinations et les points d'intérêt décrivent un projet ; les
 * vingt-cinq patrons décrivent des parcours possibles. Ni l'un ni l'autre ne dit
 * où sera le véhicule — c'est ce qui les sépare de `itineraire-public.geojson`,
 * qui reste rétrospectif et n'admet que des Point.
 *
 * Les schémas sont `strict()` : une propriété que l'export ajouterait sans qu'on
 * l'ait voulue casse la construction du site plutôt que de partir en ligne. Le
 * garde-fou contrôle ce qui ressemble à une fuite ; celui-ci contrôle ce qui
 * n'était pas prévu, ce qui n'est pas la même question.
 */

const pointsInteretSchema = z.object({
  type: z.literal('FeatureCollection'),
  _note: z.string(),
  _tri: z.string(),
  features: z.array(z.object({
    type: z.literal('Feature'),
    properties: z.object({
      id: z.string().min(1),
      nom: z.string().min(1),
      type: z.enum(['interet', 'site', 'ancrage', 'transit']),
      pays: z.string().min(2).max(3),
      natures: z.array(z.string()).optional(),
      pratiques: z.array(z.string()).optional(),
      drone: z.string().optional(),
    }).strict(),
    geometry: z.object({
      type: z.literal('Point', {
        errorMap: () => ({ message: 'seules des géométries Point sont admises ici — une LineString serait un ordre de passage' }),
      }),
      coordinates: z.tuple([z.number(), z.number()]),
    }),
  })),
});

const patronsGeoSchema = z.object({
  type: z.literal('FeatureCollection'),
  _note: z.string(),
  _saison: z.string(),
  features: z.array(z.object({
    type: z.literal('Feature'),
    properties: z.object({
      id: z.string().min(1),
      titre: z.string().min(1),
      duree_mois: z.number(),
      duree_jours: z.number(),
      destinations: z.number(),
      km_route: z.number(),
      km_moto: z.number(),
      heures_conduite: z.number(),
      traversees: z.number(),
      traversees_nommees: z.array(z.string()),
      saison_favorable: z.string(),
    }).strict(),
    // LineString ASSUMÉE : le tracé d'un patron est une séquence, et c'est son
    // objet. Vingt-cinq séquences alternatives ne disent pas laquelle sera suivie.
    geometry: z.object({
      type: z.literal('LineString'),
      coordinates: z.array(z.tuple([z.number(), z.number()])),
    }),
  })),
});

const patronsSchema = z.object({
  _note: z.string(),
  patrons: z.array(z.object({
    id: z.string().min(1),
    titre: z.string().min(1),
    duree_mois: z.number(),
    duree_jours: z.number(),
    destinations: z.number(),
    km_route: z.number(),
    km_moto: z.number(),
    heures_conduite: z.number(),
    traversees: z.number(),
    saison_favorable: z.string(),
  }).strict()),
});

export const pointsInteret = charger('points-interet.geojson', pointsInteretSchema);
export const patronsTraces = charger('patrons.geojson', patronsGeoSchema);
export const patrons = charger('patrons.json', patronsSchema);
