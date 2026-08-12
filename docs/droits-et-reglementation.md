# Droits et réglementation

Note de travail. Elle recense les contraintes qui pèsent sur la **publication**
du corpus, pas sur sa production. Elles sont instruites avant le départ parce
qu'aucune ne se règle depuis la route.

---

## Biens culturels — le cas italien

La reproduction de biens culturels appartenant à l'État italien est encadrée par
le *Codice dei beni culturali e del paesaggio*. Dès qu'une reproduction sort du
cadre strictement privé et de l'usage personnel, elle relève d'une autorisation
délivrée par l'institution qui a le bien en charge, assortie le cas échéant
d'une redevance.

Ce n'est pas une formalité marginale pour ce projet : l'itinéraire passe par
l'Italie, et l'objet même de la démarche est de **publier** des modèles de
photogrammétrie de sites et de bâtiments. Un modèle relevé sur un site
archéologique italien puis mis en ligne entre exactement dans le champ visé.

**Conduite retenue.** Aucun modèle photogrammétrique italien n'est publié tant
que le régime applicable au site concerné n'a pas été vérifié auprès de
l'institution qui en a la charge. La prise de vue et le traitement ne sont pas
concernés — seule la diffusion l'est.

À noter : la liberté de panorama n'est pas harmonisée en Europe. Elle est large
en Allemagne et dans les pays nordiques, restreinte en France pour les œuvres
architecturales protégées, quasi inexistante en Italie et en Grèce pour les
biens culturels publics. Le régime se vérifie pays par pays.

## Drone — enregistrement et zones

L'appareil retenu pèse moins de 250 g, ce qui le place en **catégorie ouverte
A1** et dispense son télépilote de formation pratique. Cela ne dispense pas de
l'**enregistrement de l'exploitant** : dès lors que l'aéronef est équipé d'un
capteur capable de saisir des données personnelles — ce qui est le cas de toute
caméra — l'enregistrement est obligatoire quel que soit le poids. Le numéro
d'exploitant doit être apposé sur l'appareil.

L'enregistrement se fait dans le pays de résidence et vaut pour l'ensemble de
l'Espace économique européen.

**Zones d'interdiction fréquentes sur l'itinéraire.** Parcs nationaux norvégiens
et suédois, sites archéologiques et zones urbaines protégées en Italie, parcs
naturels et réserves au Portugal et en Espagne, abords d'aérodromes, zones
militaires. Ces restrictions sont nationales et se vérifient avant chaque vol
sur le service officiel du pays concerné.

**Point ouvert.** La publication d'images produites par drone peut faire basculer
l'usage d'une catégorie privée vers une catégorie professionnelle selon les
États. À instruire pour les pays où la question se pose.

## Animaux — entrée en Norvège

La Norvège n'appartient pas à l'Union européenne. L'entrée de chiens depuis un
État membre suppose un passeport européen valide, une vaccination antirabique en
cours de validité et antérieure d'au moins vingt et un jours, et un **traitement
contre l'échinocoque administré et enregistré par un vétérinaire entre 24 et 120
heures avant l'entrée**.

Le traitement doit être inscrit dans le passeport avec la date et l'heure. La
déclaration à l'entrée se fait à un poste de douane tenu — plusieurs points de
passage routiers ne le sont pas, ce qui contraint l'itinéraire d'entrée.

## Personnes et propriétés privées

Traité dans `LICENCE-CONTENU.md`. Deux règles opérantes : aucune image
identifiant une personne n'est publiée sans accord, et toute demande de retrait
est exécutée sans discussion.

## Sécurité de publication

L'itinéraire n'est publié qu'en rétrospective, avec un décalage minimum d'une
étape : on ne publie jamais où l'on est, seulement où l'on était. Les
coordonnées diffusées sont arrondies et les emplacements de stationnement
nocturne ne sont jamais publiés.

Ces règles ne reposent pas sur la vigilance. Elles sont appliquées par le script
d'export et vérifiées par `scripts/garde-fou.mjs`, qui refuse la publication si
l'une d'elles est enfreinte — y compris par une coordonnée GPS oubliée dans les
métadonnées d'une photographie.
