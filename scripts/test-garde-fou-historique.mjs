#!/usr/bin/env node
/**
 * Test du contrôle d'historique.
 *
 * Il fabrique un dépôt jetable avec un vrai distant, y écrit des commits dans
 * les trois situations que le contrôle doit distinguer, et vérifie qu'il les
 * nomme correctement. Aucune valeur réelle du projet n'y figure.
 *
 * Ce que le test démontre :
 *   1. une valeur privée dans un commit LOCAL est une fuite à corriger ;
 *   2. la même valeur dans un commit DÉJÀ POUSSÉ, devenue privée après son
 *      écriture, est une publication irréversible qui réclame un arbitrage ;
 *   3. cet arbitrage, une fois déclaré, fait cesser le signalement sans jamais
 *      autoriser la valeur dans l'état courant du dépôt.
 *
 * Usage : node scripts/test-garde-fou-historique.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ICI = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCANNER = join(ICI, 'scripts', 'garde-fou-historique.mjs');

const SEL = 'sel-de-test-sans-valeur-en-production';
const VALEUR = '987654';
const hmac = (espace, v) => createHmac('sha256', SEL).update(`${espace}:${v}`).digest('hex').slice(0, 16);

const atelier = mkdtempSync(join(tmpdir(), 'hist-'));
const depot = join(atelier, 'depot');
const distant = join(atelier, 'distant.git');

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} : ${r.stderr}`);
  return r.stdout;
};

function empreintes(depuis, assume = false) {
  writeFileSync(join(depot, 'data', 'empreintes-interdites.json'), JSON.stringify({
    version_extracteur: 2,
    seuils: { monnaie: 100, masse: 20 },
    controle: hmac('controle', 'van-exploration'),
    empreintes: [{ e: hmac('monnaie', VALEUR), depuis, ...(assume ? { assume: true } : {}) }],
  }, null, 2), 'utf8');
}

const scanner = ({ sel = SEL } = {}) => {
  const r = spawnSync(process.execPath, [SCANNER, '--depot', depot], {
    encoding: 'utf8',
    env: { ...process.env, GARDE_FOU_SEL: sel },
  });
  return { code: r.status, sortie: r.stdout + r.stderr };
};

let echecs = 0;
const verifier = (ok, libelle, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'}  ${libelle}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) echecs++;
};

/* ------------------------------------------------- fabrication de l'historique */

mkdirSync(join(depot, 'data'), { recursive: true });
git(atelier, 'init', '--bare', '--initial-branch=main', distant);
git(atelier, 'init', '--initial-branch=main', depot);
git(depot, 'config', 'user.name', 'Essai');
git(depot, 'config', 'user.email', 'essai@example.invalid');
git(depot, 'remote', 'add', 'origin', distant);

const commit = (message, date) => {
  git(depot, 'add', '-A');
  const r = spawnSync('git', ['commit', '-q', '-m', message], {
    cwd: depot,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  if (r.status !== 0) throw new Error(r.stderr);
};

// Commit ancien contenant la valeur, alors qu'elle était encore publiable.
empreintes('2020-01-01');
// Nombre nu, sans symbole monétaire : seule la règle des valeurs littérales doit
// se déclencher. Écrit « 987654 EUR », le texte trahirait aussi la règle
// structurelle des montants — qu'un arbitrage sur empreinte ne couvre pas, et ne
// doit pas couvrir : ce sont deux protections indépendantes.
writeFileSync(join(depot, 'note.md'), `Référence de dossier ${VALEUR}, à classer.\n`, 'utf8');
commit('Publie la valeur, à l\'époque publiable', '2026-03-01T12:00:00+01:00');

// Puis elle est retirée du contenu courant.
writeFileSync(join(depot, 'note.md'), 'Tarif retiré.\n', 'utf8');
commit('Retire la valeur du contenu courant', '2026-03-02T12:00:00+01:00');

git(depot, 'push', '-q', '-u', 'origin', 'main');

/* --------------------------------------- 1. la valeur était privée avant le commit */

console.log('\nValeur déjà privée quand le commit a été écrit — fuite dans un commit public :\n');
empreintes('2020-01-01');
{
  const { code, sortie } = scanner();
  verifier(code === 1, 'le contrôle échoue');
  verifier(/publication\(s\) irréversible/i.test(sortie), 'la situation est nommée « irréversible »');
  verifier(/décider quoi faire/i.test(sortie), 'le rapport demande un arbitrage, pas une correction');
}

/* ------------------------------ 2. la valeur est devenue privée après le commit */

console.log('\nValeur devenue privée APRÈS le commit — changement de statut rétroactif :\n');
empreintes('2026-07-01');
{
  const { code, sortie } = scanner();
  verifier(code === 1, 'le contrôle échoue tant que rien n\'est arbitré');
  verifier(/devenues privées APRÈS avoir été écrites/i.test(sortie),
    'le rapport nomme explicitement le changement de statut');
  verifier(/statut a changé, pas le passé/i.test(sortie),
    'le rapport énonce que le changement n\'est pas rétroactif dans les faits');
  verifier(/ASSUMER/.test(sortie) && /COMPROMISE/.test(sortie),
    'les deux issues possibles sont présentées');
  verifier(/valeur devenue privée le 2026-07-01/.test(sortie), 'la date de mise au privé est affichée');
}

/* ------------------------------------------------ 3. arbitrage rendu : assumé */

console.log('\nPublication assumée :\n');
empreintes('2026-07-01', true);
{
  const { code, sortie } = scanner();
  verifier(code === 0, 'le contrôle passe une fois l\'arbitrage déclaré');
  verifier(/assumée\(s\)|assumée|assumé/i.test(sortie), 'la publication assumée reste mentionnée au rapport');
}

/* ------------------------------- 4. fuite dans un commit non poussé : bloquant */

console.log('\nMême valeur dans un commit local non poussé :\n');
writeFileSync(join(depot, 'brouillon.md'), `Rappel de la référence ${VALEUR}.\n`, 'utf8');
commit('Réintroduit la valeur localement', '2026-08-01T12:00:00+01:00');
{
  const { code, sortie } = scanner();
  verifier(code === 1, 'le contrôle échoue');
  verifier(/fuite\(s\) à corriger/i.test(sortie), 'la situation est nommée « à corriger »');
  verifier(/pas sortis/i.test(sortie), 'le rapport rappelle que ces commits sont encore rattrapables');
}

/* ---------------------------------- 5. sel erroné : la cause doit être nommée */

console.log('\nSel erroné — le contrôle doit nommer la cause, pas dérouler des erreurs :\n');
{
  const { code, sortie } = scanner({ sel: 'un-sel-qui-nest-pas-le-bon' });
  verifier(code === 1, 'le contrôle échoue');
  verifier(/sel HMAC ne correspond pas/i.test(sortie),
    'le rapport désigne le sel',
    'Échouer pour une raison fausse fait chercher le défaut là où il n\'est pas.');
  verifier(!/inspection impossible/i.test(sortie),
    'il ne noie pas la cause sous des erreurs par commit');
}

rmSync(atelier, { recursive: true, force: true });

if (echecs > 0) {
  console.error(`\n${echecs} contrôle(s) en échec sur le classement de l'historique.\n`);
  process.exit(1);
}
console.log('\nClassement vérifié : fuite corrigeable, publication irréversible et arbitrage rendu');
console.log('sont distingués, et la publication assumée ne débloque que le passé.\n');
