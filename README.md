# Van Exploration

Une expédition documentaire itinérante à travers l'Europe, en camping-car, avec
deux chiens et une moto d'enduro embarquée. Six à douze mois, de la côte
atlantique à la Scandinavie.

L'objet n'est pas le voyage mais ce qu'il produit : photographie documentaire,
photogrammétrie de sites et de bâtiments, astrophotographie, écrits de terrain,
vidéo. Le véhicule est un atelier itinérant, conçu pour capturer, traiter et
archiver en autonomie.

Ce dépôt présente le projet et sert de réceptacle à ses ressources publiables.

> **Statut : préparation.** Le choix du véhicule est *provisoire* — il reste
> suspendu à un essai physique de chargement de la moto. Tant que cet essai n'a
> pas eu lieu, rien ici ne présente ce choix comme arrêté.

---

## Ce qu'on trouve dans ce dépôt

| | |
|---|---|
| `site/` | Source du site statique publié sur GitHub Pages |
| `data/` | Spécifications véhicule et données dérivées |
| `media/` | Dérivés web publiés, et **manifestes** du corpus stocké hors dépôt |
| `docs/` | Notes de méthode, droits et réglementation |
| `scripts/` | Garde-fou anti-fuite et son test |

## Trois principes de construction

### Les données sont la vérité, l'affichage les lit

Aucun chiffre n'est saisi dans une page. Les vues de poids, de budget et
d'énergie lisent `data/derive/` **au build**, et chaque fichier est validé
contre un schéma : une donnée malformée fait échouer la construction du site au
lieu de publier une page fausse.

Conséquence utile : le site fonctionne sans JavaScript, s'indexe et s'imprime.

### La provenance de chaque chiffre reste visible

Le dossier distingue ce qui est **relevé au catalogue constructeur**, ce qui est
**mesuré**, ce qui est **devisé** et ce qui reste **à obtenir**. Cette distinction
survit jusque dans les pages publiées — c'est ce qui sépare un dossier technique
d'une brochure.

### Ce qui est privé n'est pas dans ce dépôt

Le projet vit dans **deux dépôts distincts**. Celui-ci est public. Un second,
privé, porte les budgets détaillés, l'inventaire valorisé du matériel, la
configuration commerciale du véhicule, les documents administratifs et le
planning prospectif.

Le choix de deux dépôts plutôt qu'un `.gitignore` est délibéré : un fichier
ignoré est une protection qu'un seul commit distrait fait tomber, et l'historique
Git garde tout.

Le dépôt privé n'envoie ici que des **agrégats** produits par un script d'export
en liste blanche. Aucun montant absolu ne circule — le budget est publié en
répartition, jamais en euros, et la part du véhicule en est exclue. Rien ne
remonte du public vers le privé.

## Le garde-fou

`scripts/garde-fou.mjs` relit l'intégralité du dépôt à chaque publication et
refuse tout ce qui ressemble à une donnée qui n'aurait pas dû sortir : montants,
identifiants commerciaux, vocabulaire administratif, plaque d'immatriculation,
coordonnées trop précises, fichiers sources, dérivés trop lourds, et
**coordonnées GPS oubliées dans les métadonnées EXIF d'une photographie** — la
fuite la plus probable du dispositif, puisque chaque image d'astrophotographie
porte la position du lieu où elle a été prise.

Il refuse aussi **toute valeur littérale présente dans les données privées** et
non publiée par l'export : un montant, une masse détaillée, une coordonnée
recopiés à la main dans une page sont détectés même si aucune autre règle ne
s'applique.

Le dépôt privé fournit pour cela une liste d'empreintes. Elle est produite en
**HMAC salé**, pas en simple hachage : un SHA-256 de montant à six chiffres se
casse par énumération en quelques millisecondes, et publier des empreintes non
salées reviendrait à publier les montants. Le sel n'est pas versionné ; il vit
en secret d'Actions sous le nom `GARDE_FOU_SEL`. En son absence, le garde-fou
**échoue** au lieu de laisser passer.

L'extraction est contextuelle : `189` seul n'est pas un candidat, `189 kg` en est
un. Sans cette précaution le contrôle croulerait sous les faux positifs et
finirait désactivé — un garde-fou désactivé protège moins qu'un garde-fou absent,
parce qu'on croit encore l'avoir.

Il refuse enfin tout GeoJSON public portant un attribut de **date, d'ordre ou de
séquence**. La règle du décalage d'étape protège contre la publication d'un lieu
où l'on est encore ; elle ne voit pas un `ordre: 3` dans les propriétés. Un ordre
implique une séquence, une séquence implique un calendrier, et un calendrier dit
où sera le véhicule.

Il ne fait pas confiance à l'export : il vérifie le résultat.

### Ce que le garde-fou ne couvre pas

Le contrôle des valeurs littérales s'arrête **en dessous de 100 € et de 20 kg**.
Sous ces magnitudes, un nombre est trop banal pour être distingué du bruit, et le
contrôler produirait assez de faux positifs pour que la règle finisse désactivée.

Une masse de 9 kg ou un montant de 50 € recopiés à la main depuis le dépôt privé
**passeront sans être signalés**. Ce qui les couvre encore : l'interdiction des
fichiers sources, la règle des montants en euros — qui attrape toute écriture
portant le symbole, quelle que soit la valeur — et la relecture. Rien d'autre.

C'est une limite assumée, pas un oubli. Elle est répétée en tête de
`scripts/garde-fou.mjs` pour qu'on ne la redécouvre pas trop tard.

`scripts/test-garde-fou.mjs` fabrique des fichiers volontairement fautifs et
vérifie que chaque règle mord, puis qu'un dépôt propre passe. Ce test tourne
avant le garde-fou à chaque CI — un garde-fou jamais déclenché est un garde-fou
qu'on croit fonctionnel.

## Fichiers lourds

Ce dépôt ne contient **que des dérivés web**, plafonnés à 2 Mo par fichier. Pas
de Git LFS : un fichier LFS n'est pas résolu par le build Pages sans consommer du
quota à chaque publication, et Pages plafonne de toute façon le site à 1 Go.

RAW, masters vidéo, nuages de points et jeux de photogrammétrie complets vivent
en **stockage externe**, indexés par les `media/*/manifest.csv` : identifiant,
date, lieu, volume, empreinte de l'archive, support, état. Le dépôt décrit le
corpus sans le contenir.

## Développement

```bash
cd site && npm install && npm run build
```

```bash
node scripts/test-garde-fou.mjs && node scripts/garde-fou.mjs
```

## Licences

Code sous licence **MIT** (`LICENSE`). Contenu documentaire — photographies,
modèles, textes, vidéos — sous licence **CC BY-NC-ND 4.0**
(`LICENCE-CONTENU.md`), qui précise aussi le traitement des personnes
photographiées et des propriétés privées.
