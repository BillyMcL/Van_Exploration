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

const reglesSchema = z.object({
  regles: z.array(z.object({ id: z.string(), titre: z.string(), enonce: z.string() })).nonempty(),
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

/* ------------------------------------------------------------------ données */

export const manifest = charger('_manifest.json', manifestSchema);
export const budget = charger('budget-repartition.json', budgetSchema);
export const poids = charger('poids-categories.json', poidsSchema);
export const configurations = charger('configurations.json', configurationsSchema);
export const regles = charger('regles-exploitation.json', reglesSchema);
export const energie = charger('energie-scenarios.json', energieSchema);

/**
 * Cohérence croisée : le manifeste annonce des fichiers, ils doivent tous être
 * chargés ici. Un export qui gagne une sortie sans que le site la consomme est
 * une donnée publiée que personne ne regarde.
 */
const charges = new Set([
  'budget-repartition.json', 'poids-categories.json',
  'configurations.json', 'regles-exploitation.json', 'energie-scenarios.json',
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
