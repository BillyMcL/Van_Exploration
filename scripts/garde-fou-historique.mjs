#!/usr/bin/env node
/**
 * Garde-fou sur l'historique.
 *
 * Le garde-fou ordinaire inspecte l'arbre de travail. Il ne dit rien de ce qui a
 * été commité puis corrigé : une valeur retirée d'un fichier reste lisible dans
 * le commit qui l'a introduite, et rendre un dépôt public rend son historique
 * public avec lui.
 *
 * Ce script rejoue le garde-fou sur chaque commit atteignable, avec la liste
 * d'empreintes courante injectée dans chaque arbre extrait.
 *
 * LA LIMITE STRUCTURELLE QU'IL FAUT CONNAÎTRE
 *
 * Juger les commits anciens sur ce qui est privé aujourd'hui est le bon choix —
 * mais le jour où une valeur passe de publiable à privée, tout l'historique
 * devient rétroactivement fautif. Sans traitement, la CI échouerait
 * indéfiniment sur des commits déjà publics que personne ne peut corriger.
 *
 * Un changement de statut n'est pas rétroactif dans les faits. Ce qui a été
 * publié est publié : le garde-fou empêche les fuites futures, il n'annule pas
 * les passées. Ce script distingue donc deux situations qui n'appellent pas la
 * même réponse :
 *
 *   — FUITE À CORRIGER : le commit n'est pas encore poussé, ou la valeur était
 *     déjà privée quand il a été écrit. On corrige avant de publier.
 *
 *   — PUBLICATION IRRÉVERSIBLE : le commit est déjà public et la valeur était
 *     publiable quand il a été écrit. Il n'y a plus rien à bloquer. La question
 *     devient : assumer la publication, ou considérer la donnée comme
 *     compromise et changer ce qu'elle protège.
 *
 * Le second cas exige un arbitrage explicite, déclaré dans export/assume.json du
 * dépôt privé. Tant qu'il n'est pas rendu, ce script échoue — il ne bloque pas
 * une correction impossible, il réclame une décision.
 *
 * Usage :
 *   node scripts/garde-fou-historique.mjs
 *   node scripts/garde-fou-historique.mjs --depuis origin/main
 *
 * Sortie : code 0 si l'historique est propre ou entièrement arbitré, 1 sinon.
 */

import { mkdtempSync, rmSync, existsSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ICI = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const GARDE_FOU = join(ICI, 'scripts', 'garde-fou.mjs');

// `--depot` permet d'inspecter un autre dépôt que celui-ci, ce dont le test a
// besoin pour fabriquer des historiques de démonstration.
const iDepot = process.argv.indexOf('--depot');
const RACINE = iDepot !== -1 ? process.argv[iDepot + 1] : ICI;
const EMPREINTES = join(RACINE, 'data', 'empreintes-interdites.json');

const iDepuis = process.argv.indexOf('--depuis');
const depuis = iDepuis !== -1 ? process.argv[iDepuis + 1] : null;

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: RACINE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} : ${r.stderr?.trim()}`);
  return r.stdout;
};

/* ------------------------------------------------------------------- le sel */

let sel = process.env.GARDE_FOU_SEL ?? null;
if (!sel) {
  const voisin = join(ICI, '..', 'Van_Exploration-prive', 'export', '.sel');
  if (existsSync(voisin)) sel = readFileSync(voisin, 'utf8').trim();
}
if (existsSync(EMPREINTES) && !sel) {
  console.error('\nLe sel HMAC est introuvable. Le contrôle des valeurs littérales ne peut pas');
  console.error('s\'exécuter sur l\'historique, donc rien n\'est déclaré propre.\n');
  process.exit(1);
}

/* ------------------------------------------------ commits déjà rendus publics
 *
 * Un commit atteignable depuis une référence distante est sorti : il a été
 * poussé, cloné peut-être, indexé peut-être. Le corriger localement ne le
 * rattrape pas.
 */
let dejaPousses = new Set();
try {
  dejaPousses = new Set(git('rev-list', '--remotes').trim().split('\n').filter(Boolean));
} catch { /* dépôt sans distant : tout est encore corrigeable */ }

/* --------------------------------------------------------------- les commits */

const plage = depuis ? [`${depuis}..HEAD`] : ['--all'];
const commits = git('rev-list', ...plage).trim().split('\n').filter(Boolean);

if (commits.length === 0) {
  console.log('\nAucun commit à inspecter.\n');
  process.exit(0);
}

console.log(`Garde-fou sur l'historique — ${commits.length} commit(s).\n`);

const aCorriger = [];
const irreversibles = [];
const assumees = [];

for (const [i, sha] of commits.entries()) {
  const sujet = git('log', '-1', '--format=%s', sha).trim();
  const date = git('log', '-1', '--format=%ad', '--date=short', sha).trim();
  const public_ = dejaPousses.has(sha);

  const dossier = mkdtempSync(join(tmpdir(), 'garde-fou-hist-'));
  const archive = join(dossier, '.arbre.tar');
  let etat = '·';

  try {
    git('archive', '--format=tar', '-o', archive, sha);
    const extraction = spawnSync('tar', ['-xf', archive, '-C', dossier], { encoding: 'utf8' });
    if (extraction.status !== 0) throw new Error(`extraction : ${extraction.stderr?.trim()}`);
    rmSync(archive, { force: true });

    // La liste d'empreintes du jour est injectée dans l'arbre ancien : ce qui est
    // privé aujourd'hui est recherché dans tout l'historique.
    if (existsSync(EMPREINTES)) {
      mkdirSync(join(dossier, 'data'), { recursive: true });
      copyFileSync(EMPREINTES, join(dossier, 'data', 'empreintes-interdites.json'));
    }

    const r = spawnSync(process.execPath, [GARDE_FOU, '--racine', dossier, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, ...(sel ? { GARDE_FOU_SEL: sel } : {}) },
    });

    if (r.status !== 0) {
      const { violations } = JSON.parse(r.stdout);
      for (const v of violations) {
        // Une valeur devenue privée APRÈS l'écriture du commit était publiable
        // au moment où elle a été écrite. Ce n'est pas une négligence.
        const posterieure = v.privee_depuis && v.privee_depuis > date;
        const contexte = { sha, sujet, date, ...v, posterieure };

        if (!public_) aCorriger.push(contexte);
        else if (v.assume) assumees.push(contexte);
        else irreversibles.push(contexte);
      }
      etat = aCorriger.some((c) => c.sha === sha) ? '✗' : '!';
    }
  } catch (e) {
    etat = '!';
    aCorriger.push({ sha, sujet, date, regle: 'inspection', detail: e.message, extrait: '' });
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }

  console.log(`  ${etat} ${sha.slice(0, 7)}  ${date}  ${public_ ? '' : '[local] '}${sujet.slice(0, 58)}`);
  if ((i + 1) % 50 === 0) console.log(`    … ${i + 1}/${commits.length}`);
}

/* ------------------------------------------------------------------ rapport */

const bloc = (titre, liste) => {
  console.error(`\n${titre}\n`);
  for (const c of liste) {
    console.error(`  ${c.sha.slice(0, 7)}  ${c.date}  ${c.sujet}`);
    console.error(`      ${c.fichier ?? ''} [${c.regle}] ${c.extrait}`);
    if (c.privee_depuis) console.error(`      valeur devenue privée le ${c.privee_depuis}`);
    console.error('');
  }
};

if (assumees.length) {
  console.log(`\n${assumees.length} publication(s) antérieure(s) assumée(s), pour mémoire :\n`);
  for (const c of assumees) {
    console.log(`  ${c.sha.slice(0, 7)}  ${c.date}  ${c.fichier} [${c.regle}] ${c.extrait}`);
  }
}

if (!aCorriger.length && !irreversibles.length) {
  console.log(`\nHistorique propre sur ${commits.length} commit(s).\n`);
  process.exit(0);
}

if (aCorriger.length) {
  bloc(`${aCorriger.length} fuite(s) à corriger — commits pas encore publics :`, aCorriger);
  console.error('Ces commits ne sont pas sortis. Réinitialiser l\'historique avant publication');
  console.error('est plus sûr que de le réécrire après.\n');
}

if (irreversibles.length) {
  const parStatut = irreversibles.filter((c) => c.posterieure);
  bloc(`${irreversibles.length} publication(s) irréversible(s) — commits déjà publics :`, irreversibles);

  if (parStatut.length) {
    console.error('Ces valeurs sont devenues privées APRÈS avoir été écrites : elles étaient');
    console.error('publiables au moment du commit. Le statut a changé, pas le passé.\n');
  }

  console.error('Ces commits sont déjà poussés. Ils ont pu être clonés, mis en cache, indexés.');
  console.error('Réécrire l\'historique ne les rattrape pas — la question n\'est plus de bloquer');
  console.error('un push, elle est de décider quoi faire :\n');
  console.error('  — ASSUMER la publication : déclarer la valeur dans export/assume.json du');
  console.error('    dépôt privé, sous la clé « espace valeur » lisible dans l\'extrait ci-dessus,');
  console.error('    puis relancer node export/empreintes.mjs. Le contrôle cessera de la signaler');
  console.error('    dans les commits antérieurs — et continuera de la refuser sur HEAD.\n');
  console.error('  — CONSIDÉRER LA DONNÉE COMPROMISE et changer ce qu\'elle protège : remplacer');
  console.error('    un identifiant, revoir une couverture, déplacer un objet de valeur. La');
  console.error('    valeur n\'a alors plus à être protégée et sort des données privées.\n');
  console.error('Tant qu\'aucune des deux n\'est actée, ce contrôle échoue. Il ne réclame pas une');
  console.error('correction impossible : il réclame un arbitrage.\n');
}

process.exit(1);
