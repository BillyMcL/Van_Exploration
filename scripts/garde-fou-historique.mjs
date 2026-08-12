#!/usr/bin/env node
/**
 * Garde-fou sur l'historique.
 *
 * Le garde-fou ordinaire inspecte l'arbre de travail. Il ne dit rien de ce qui a
 * été commité puis corrigé : une valeur retirée d'un fichier reste lisible dans
 * le commit qui l'a introduite, et rendre un dépôt public rend son historique
 * public avec lui.
 *
 * Ce script rejoue le garde-fou sur chaque commit atteignable. La liste
 * d'empreintes courante est injectée dans chaque arbre extrait : un commit
 * ancien est jugé sur ce qui est privé aujourd'hui, pas sur ce qui l'était au
 * moment où il a été écrit.
 *
 * Usage :
 *   node scripts/garde-fou-historique.mjs
 *   node scripts/garde-fou-historique.mjs --depuis origin/main
 *
 * Sortie : code 0 si tout l'historique est propre, 1 sinon.
 */

import { mkdtempSync, rmSync, existsSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const GARDE_FOU = join(RACINE, 'scripts', 'garde-fou.mjs');
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
  const voisin = join(RACINE, '..', 'Van_Exploration-prive', 'export', '.sel');
  if (existsSync(voisin)) sel = readFileSync(voisin, 'utf8').trim();
}
if (existsSync(EMPREINTES) && !sel) {
  console.error('\nLe sel HMAC est introuvable. Le contrôle des valeurs littérales ne peut pas');
  console.error('s\'exécuter sur l\'historique, donc rien n\'est déclaré propre.\n');
  process.exit(1);
}

/* --------------------------------------------------------------- les commits */

const plage = depuis ? [`${depuis}..HEAD`] : ['--all'];
const commits = git('rev-list', ...plage).trim().split('\n').filter(Boolean);

if (commits.length === 0) {
  console.log('\nAucun commit à inspecter.\n');
  process.exit(0);
}

console.log(`Garde-fou sur l'historique — ${commits.length} commit(s).\n`);

const fautifs = [];

for (const [i, sha] of commits.entries()) {
  const sujet = git('log', '-1', '--format=%s', sha).trim();
  const date = git('log', '-1', '--format=%ad', '--date=short', sha).trim();

  const dossier = mkdtempSync(join(tmpdir(), 'garde-fou-hist-'));
  const archive = join(dossier, '.arbre.tar');
  try {
    git('archive', '--format=tar', '-o', archive, sha);
    const extraction = spawnSync('tar', ['-xf', archive, '-C', dossier], { encoding: 'utf8' });
    if (extraction.status !== 0) throw new Error(`extraction : ${extraction.stderr?.trim()}`);
    rmSync(archive, { force: true });

    // La liste d'empreintes du jour est injectée dans l'arbre ancien : ce qui est
    // privé aujourd'hui ne doit se trouver nulle part dans l'historique.
    if (existsSync(EMPREINTES)) {
      mkdirSync(join(dossier, 'data'), { recursive: true });
      copyFileSync(EMPREINTES, join(dossier, 'data', 'empreintes-interdites.json'));
    }

    const r = spawnSync(process.execPath, [GARDE_FOU, '--racine', dossier], {
      encoding: 'utf8',
      env: { ...process.env, ...(sel ? { GARDE_FOU_SEL: sel } : {}) },
    });

    const marque = r.status === 0 ? '·' : '✗';
    console.log(`  ${marque} ${sha.slice(0, 7)}  ${date}  ${sujet.slice(0, 62)}`);
    if (r.status !== 0) fautifs.push({ sha, sujet, date, rapport: (r.stdout + r.stderr).trim() });
  } catch (e) {
    console.log(`  ! ${sha.slice(0, 7)}  ${date}  inspection impossible — ${e.message}`);
    fautifs.push({ sha, sujet, date, rapport: e.message });
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }

  if ((i + 1) % 50 === 0) console.log(`    … ${i + 1}/${commits.length}`);
}

/* ------------------------------------------------------------------ verdict */

if (fautifs.length === 0) {
  console.log(`\nHistorique propre sur ${commits.length} commit(s). Le dépôt peut devenir public.\n`);
  process.exit(0);
}

console.error(`\n${fautifs.length} commit(s) fautif(s) :\n`);
for (const f of fautifs) {
  console.error(`  ${f.sha}  ${f.date}  ${f.sujet}`);
  console.error(f.rapport.split('\n').map((l) => `    ${l}`).join('\n'));
  console.error('');
}
console.error('Une branche propre ne suffit pas : ces valeurs restent lisibles dans l\'historique.');
console.error('Réinitialiser l\'historique avant publication est plus sûr que de le réécrire après.\n');
process.exit(1);
