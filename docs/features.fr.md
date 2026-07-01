# OGN 3D Viewer — Guide

Rejeu 3D des vols de planeurs de l'[Open Glider Network](http://wiki.glidernet.org/) (OGN), directement dans le navigateur. Choisissez un aérodrome et une date — ou chargez vos propres traces — et rejouez la journée sur un relief 3D, avec lecture animée, vue cockpit et affichage tête haute.

## Chargement des données

- **Recherche d'aérodrome** — par code OACI avec autocomplétion, pour une date donnée.
- **Mode direct** — vue temps réel épinglée à l'heure courante, rafraîchissant les planeurs actifs toutes les 20 s (balises récentes en couleur, plus anciennes atténuées).
- **Import de fichiers locaux** — glissez ou choisissez vos propres traces **IGC / GPX / KML** pour les rejouer de la même façon, sans passer par OGN.

## La scène

- **Relief 3D** avec imagerie satellite et exagération verticale réglable.
- **Trois vues** — vue d'ensemble (dessus), vue cockpit (subjective, l'horizon s'incline dans les virages) et caméra poursuite qui suit le planeur.
- **Caméra cockpit** — suivi du cap ou regard libre.
- **Affichage tête haute (HUD)** — cap, altitude et vario du planeur suivi.
- **Cône de finesse** — un cône d'atteignabilité optionnel autour de l'aérodrome (finesse, hauteur de sécurité et rayon réglables).
- **Ombres au sol** — projetées à la verticale (indicateur de position) ou selon la direction du soleil.
- **Rideau d'altitude** — un voile translucide reliant chaque trace au sol.
- **Étiquettes par aéronef** — immatriculation, altitude, vitesse, vario, cap.

## Lecture

- **Lecture temporelle** — curseur d'heure de la journée et vitesses 1× / 8× / 30× / 120×.
- **Modes de trace** — historique, historique + futur, ou fenêtre glissante.
- **Effets de trace** — basique, néon, contrail ou bloom.
- **Lissage des traces** — interpolation spline Catmull-Rom pour des trajectoires fluides.
- **Pertes de réception** — les intervalles sans balise OGN sont interpolés et tracés en pointillés.
- **Graphes** — altitude, vitesse et cap au fil du temps.

## Instruments & trafic

- **Attitude estimée** — chaque planeur s'incline dans les virages et prend de l'assiette selon la vitesse air.
- **Vario compensé** — vario à énergie totale par défaut (désactivable pour la vitesse verticale brute).
- **Son du vario** — une tonalité de montée/descente optionnelle pour le planeur suivi.
- **Conscience du trafic** — un radar cap-en-haut des aéronefs proches, ou un indicateur directionnel anti-collision.

## Raccourcis clavier

- **V** — changer de vue
- **1 / 2 / 3** — choisir un planeur
- **J / K** — planeur précédent / suivant
- **Espace** — lecture / pause
- **Flèches** — pivoter / incliner / zoomer

## Notes & limites

- Les traces OGN dépendent de la réception par les stations au sol — trous et décrochages possibles.
- L'attitude (inclinaison/assiette) est **estimée** à partir de la trace sol et de la vitesse, non mesurée.
- L'OGN ne conserve les traces IGC qu'environ **24 h**, les dates anciennes sont donc souvent vides.
- Merci de respecter la [politique d'usage des données OGN](https://www.glidernet.org/ogn-data-usage/).

L'application est une SPA côté client ; code source et signalements sur [GitHub](https://github.com/s-celles/ogn-3d-viewer).
