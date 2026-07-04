---
title: "OGN 3D Viewer : rejouer les vols de planeurs en 3D, dans le navigateur"
description: "Les coulisses techniques d'OGN 3D Viewer : terrain en tuiles, reconstruction du vol, chant du vario synthétisé, ciel calculé et données Open Glider Network."
author: Sébastien Celles
lang: fr
date: 2026-06-28
updated: 2026-07-04
tags: [vol-a-voile, ogn, deck-gl, typescript, webgl, dataviz, open-source]
---

# OGN 3D Viewer : rejouer les vols de planeurs en 3D, dans le navigateur

Le vol à voile, que je ne pratique plus faute de temps, continue de m'intéresser — et ce projet m'a donné l'occasion de le croiser avec le développement, l'un de mes loisirs techniques. Je suis enseignant, et s'il m'arrive d'enseigner la programmation, développer reste pour moi un plaisir avant tout.

**OGN 3D Viewer** est un rejeu 3D des vols de planeurs de l'[Open Glider Network](http://wiki.glidernet.org/) (OGN) qui tourne entièrement dans le navigateur. On y choisit un aérodrome par son code OACI et une date, et l'application reconstruit les trajectoires de la journée au-dessus du relief, avec lecture temporelle, vue cockpit et un affichage à l'écran du cap, de l'altitude et du vario. On y croise aussi bien des planeurs que des avions, et l'on reconnaît à l'œil les différents modes de mise en l'air : le treuil (montée courte et raide jusqu'au largage), le remorquage (le planeur accroché derrière son avion remorqueur), ou le décollage autonome d'un motoplaneur.

Démo : https://s-celles.github.io/ogn-3d-viewer/

Pour se faire une idée — et essayer directement —, le plus simple est de partir de chez moi, à Poitiers-Biard ([LFBI](https://s-celles.github.io/ogn-3d-viewer/?icao=LFBI)), avant d'aller voir les grands sites alpins, de plaine et pyrénéens. Chaque code ouvre le viewer sur le terrain correspondant, pour la journée en cours :

| Site | Code | Club |
|---|---|---|
| Vinon-sur-Verdon | [LFNF](https://s-celles.github.io/ogn-3d-viewer/?icao=LFNF) | Assoc. Aéronautique Verdon Alpilles (AAVA) |
| Sisteron-Vaumeilh | [LFNS](https://s-celles.github.io/ogn-3d-viewer/?icao=LFNS) | Aéro-Club International de Sisteron (ACIS) |
| Château-Arnoux-Saint-Auban | [LFMX](https://s-celles.github.io/ogn-3d-viewer/?icao=LFMX) | CNVV — Centre National de Vol à Voile |
| Gap-Tallard | [LFNA](https://s-celles.github.io/ogn-3d-viewer/?icao=LFNA) | Aéro-club d'Affaires de Tallard |
| La Motte-du-Caire | [LF0431](https://s-celles.github.io/ogn-3d-viewer/?icao=LF0431) | CVV de La Motte-du-Caire (vélisurface) |
| Fayence-Tourrettes | [LFMF](https://s-celles.github.io/ogn-3d-viewer/?icao=LFMF) | Les Planeurs du Pays de Fayence (AAPCA) |
| Issoudun-Le Fay | [LFEK](https://s-celles.github.io/ogn-3d-viewer/?icao=LFEK) | Aéro-club d'Issoudun |
| Buno-Bonnevaux | [LFFB](https://s-celles.github.io/ogn-3d-viewer/?icao=LFFB) | Assoc. Aéronautique du Val d'Essonne |
| Beynes-Thiverval | [LFPF](https://s-celles.github.io/ogn-3d-viewer/?icao=LFPF) | Centre Aéronautique de Beynes |
| Saint-André-de-l'Eure | [LFFD](https://s-celles.github.io/ogn-3d-viewer/?icao=LFFD) | Centre Vélivole du Val de l'Eure |
| Saint-Gaudens-Montréjeau | [LFIM](https://s-celles.github.io/ogn-3d-viewer/?icao=LFIM) | Aéro-club de Saint-Gaudens |
| Saint-Girons-Antichan | [LFCG](https://s-celles.github.io/ogn-3d-viewer/?icao=LFCG) | Aéro-club de l'Ariège |
| Bagnères-de-Luchon | [LFCB](https://s-celles.github.io/ogn-3d-viewer/?icao=LFCB) | Aéro-club de Luchon |
| Aire-sur-l'Adour | [LFDA](https://s-celles.github.io/ogn-3d-viewer/?icao=LFDA) | Aéro-club d'Aire-sur-l'Adour |

Sans paramètre de date, le viewer affiche le jour courant ; on peut viser une journée précise en ajoutant `&date=AAAA-MM-JJ` (l'OGN ne conserve toutefois les traces qu'environ 24 h). La plupart de ces identifiants sont des codes OACI à quatre lettres ; La Motte-du-Caire, vélisurface, utilise un code privé français (LF0431) que l'appli reconnaît tout de même.

## Une application 100 % navigateur, sans backend

C'est une application monopage en TypeScript strict, sans aucun serveur applicatif : tout le calcul se fait côté client, et le site est simplement publié sur GitHub Pages à chaque push, via un workflow GitHub Actions qui vérifie les types, lance les tests et construit le bundle.

L'ensemble est bundlé avec [Bun](https://bun.sh/), qui fait office de bundler, de serveur de développement et de lanceur de tests — une seule chaîne d'outils, ce qui allège beaucoup le projet. Le rendu 3D repose sur [deck.gl](https://deck.gl/) 9, dont je n'utilise que les paquets nécessaires, tree-shakés. deck.gl et luma.gl sont d'ailleurs figés en 9.1.0 : la 9.3 a changé l'API de maillage sur laquelle s'appuie mon terrain construit à la main, et la mise à jour le cassait. Le genre de détail qui coûte une soirée, et qu'on finit par documenter dans le `package.json` pour le prochain qui passera par là.

## Le terrain : tout se joue au raccord entre dalles

Le relief vient de tuiles d'élévation Terrarium d'AWS, texturées avec l'imagerie satellite Esri. Plutôt que d'utiliser le `TerrainLayer` tout fait de deck.gl, je décode et maille le terrain moi-même, pour deux raisons.

La première est une question de fidélité des altitudes. Servi en http, le décodage des tuiles Terrarium dans le Web Worker de deck.gl corrompt l'élévation encodée dans les canaux RGB — d'où des pics aléatoires dans le relief, jusque sur la mer où l'altitude devrait pourtant être négative. La même page ouverte en `file://`, qui retombe sur un décodage en thread principal, reste propre : le problème vient bien du chemin worker. En décodant moi-même le PNG en JavaScript pur, je le contourne entièrement. J'ai isolé et documenté le bug, avec un cas reproductible minimal, sur le tracker de deck.gl ([issue #10400](https://github.com/visgl/deck.gl/issues/10400)).

La seconde, plus intéressante, est le raccord entre dalles. Le terrain arrive en tuiles indépendantes, chacune transformée en son propre maillage. Tant qu'on construit ces maillages dans un repère métrique local à chaque tuile, les bords de deux dalles voisines ne tombent pas exactement au même endroit, et il apparaît de fines fentes le long des coutures. La solution a été de positionner chaque maillage directement en coordonnées géographiques (longitude/latitude), à partir de la *bounding box* exacte de la tuile : les bords partagés coïncident alors rigoureusement et les dalles se referment proprement. Le même cache de tuiles décodées sert ensuite à retrouver l'altitude du sol sous n'importe quel point chargé — sans requête réseau supplémentaire — pour empêcher les planeurs de passer sous le relief dans les reliefs escarpés.

Sur ce relief se drape un **fond de carte** au choix — satellite Esri, OpenTopoMap ou OpenStreetMap. Et sur la France, une option expérimentale bascule vers un MNT bien plus fin — le **RGE ALTI / LIDAR HD** de l'IGN — texturé par la **BD ORTHO 20 cm**, le tout servi sans clé par la Géoplateforme ; ailleurs, on retombe sur les sources mondiales.

## Un ciel calculé

L'éclairage n'est pas décoratif : il est calculé à partir de la position réelle du soleil. Pour l'aérodrome chargé, la date et l'heure de lecture, l'application déduit la hauteur du soleil (formule de position solaire NOAA/SunCalc) et en tire la couleur du ciel — bleu franc soleil haut, teintes dorées rasantes au lever et au coucher, crépuscule puis nuit sous l'horizon. La même position oriente la lumière directionnelle qui éclaire le relief : son intensité faiblit le soir, sa teinte se réchauffe près de l'horizon. Le disque solaire et la Lune — avec sa phase, elle aussi calculée — prennent place dans le ciel, et un terminateur jour/nuit évite que le monde soit uniformément sombre la nuit. Comme la lumière est directionnelle, le relief se modèle au fil de la journée : les versants exposés s'éclairent, ceux qui tournent le dos au soleil s'assombrissent, et ce modelé s'accentue quand le soleil rase l'horizon — un ombrage du relief par la lumière, plutôt que des ombres portées calculées. Concrètement, quand on déroule la journée, l'ombre et la lumière suivent le vrai soleil.

## Reconstruire le vol à partir de balises éparses

C'est le cœur du projet. Les balises OGN sont espacées dans le temps et bruitées : telles quelles, le vol est saccadé et l'on ne « sent » pas le planeur.

Je lisse donc les trajectoires par splines de Catmull-Rom, qui passent exactement par les points reçus tout en densifiant les segments intermédiaires, pour un mouvement fluide. À partir de cette trajectoire, j'estime l'**assiette** de chaque planeur : l'inclinaison est déduite du taux de virage et de la vitesse sol — faute d'avoir la vitesse air dans les données — et plafonnée à des valeurs réalistes. L'affichage peut aussi basculer en **vario à énergie totale**, comme l'est celui d'un planeur, plutôt que d'afficher la seule vitesse verticale issue du GPS : on ajoute à la vario brute le terme d'énergie cinétique, pour qu'une ressource ne se lise pas comme une ascendance. La compensation exacte réclamerait la vitesse air ; faute de l'avoir dans les données, je l'approche par la vitesse sol — l'esprit d'un vario TE, pas sa rigueur.

Deux corrections rendent le rendu honnête. Une correction géoïde/datum recale les altitudes GNSS (ellipsoïdales) sur le relief orthométrique, pour que les planeurs ne flottent pas au-dessus du sol. Et les pertes de réception, fréquentes dès qu'un planeur sort de la portée des stations au sol, sont **détectées et tracées en pointillés** plutôt que masquées : on voit ainsi où la donnée manque, au lieu de croire à une ligne droite inventée.

## Trois vues pour suivre les vols

L'application propose trois points de vue, qu'on enchaîne d'une touche. La **vue d'ensemble** regarde la scène de plus haut : un curseur fait basculer la caméra de la verticale (à l'aplomb) jusqu'au ras du relief, pour situer tous les planeurs d'un coup d'œil. La **vue cockpit**, à la première personne, place l'œil dans le planeur suivi ; en mode accroché, l'horizon s'incline dans les virages, à partir de l'inclinaison estimée — on retrouve la sensation du vol. Enfin la **caméra de poursuite** suit le planeur de l'extérieur, et on tourne librement autour de lui (azimut, hauteur, distance) pour observer une spirale ou une transition sous l'angle voulu.

## Le chant du vario, synthétisé

Un vario, ça s'écoute autant que ça se lit. Le planeur suivi a donc son chant de vario, **entièrement synthétisé via la Web Audio API** — pas le moindre échantillon audio. Un oscillateur carré est « gaté » par un ordonnanceur : bips de plus en plus aigus et rapprochés à mesure que l'ascendance se renforce, son grave et continu en descendance, et silence dans une bande morte autour de zéro, exactement comme un vario électronique. La fréquence et la cadence sont calées sur la vitesse verticale, programmées un peu en avance pour rester nettes. Comme les navigateurs n'autorisent le son qu'après une action de l'utilisateur, l'audio ne démarre qu'au premier clic.

## Les données : direct depuis l'OGN FlightBook

Tout est tiré en direct de l'API [FlightBook](https://flightbook.glidernet.org/) de l'OGN, appelée directement depuis le navigateur (l'API expose un CORS ouvert). Le carnet du jour et les traces IGC sont récupérés à la volée. L'aérodrome et la date se reflètent dans l'URL (`?icao=…&date=…`), si bien qu'un lien rejoue directement une journée donnée et qu'on peut la partager — le FlightBook, lui, ne pointe pas (encore) vers l'appli. Un mode temps réel épingle la vue à l'heure courante et rafraîchit les planeurs actifs toutes les vingt secondes (ce point reste à peaufiner).

Un mot, enfin, sur les données : elles sont mises à disposition gratuitement mais ne sont pas « libres de droits ». Leur réutilisation est encadrée par la [politique d'usage de l'OGN](https://www.glidernet.org/ogn-data-usage/), qui les place sous licence ODbL — un cadre qu'on se doit de respecter quand on construit dessus, notamment vis-à-vis des pilotes ayant choisi de ne pas être suivis ou identifiés. L'OGN repose entièrement sur des bénévoles et leurs stations de réception, et mérite d'être crédité à ce titre.

L'interface est trilingue (français, anglais, allemand), installable en PWA, et les modules « purs » — parsing IGC, géométrie de vol, position du soleil — sont couverts par des tests unitaires.

## Des repères dans le paysage : sommets et waypoints

Pour situer un vol dans son terrain, l'application peut planter des repères dans la scène. Les **sommets nommés** proviennent d'OpenStreetMap, interrogé à la volée via l'API publique [Overpass](https://overpass-api.de/) (ouverte, sans clé) autour du point de vue courant ; les résultats sont mis en cache par zone (mémoire + `localStorage`), si bien qu'un panoramique déjà exploré ne relance aucune requête. La taille de l'étiquette croît avec l'altitude du sommet, pour que les grands se détachent des petits, et un curseur règle la densité affichée.

On peut aussi importer ses propres **waypoints au format SeeYou `.cup`** (celui des calculateurs XCSoar / LK8000) — aérodromes, points de virage, vachables, obstacles. Chaque point est catégorisé d'après sa colonne de style et reçoit une icône et une couleur : ✈ aérodrome, ▽ vachable, ▲ sommet ou col, ✕ obstacle (antenne, pylône), ◆ repère. Comme un fichier national peut compter des milliers de points, seul le voisinage du point de vue est dessiné, pour rester fluide.

## Limites assumées

Rien de tout cela ne remplace de vraies données de vol. L'attitude est **estimée**, pas mesurée ; la vitesse sol sert de proxy à la vitesse air, faute de mieux ; les positions sont interpolées entre balises, donc ce n'est pas exactement la trajectoire réellement suivie ; et l'OGN ne conserve les traces IGC qu'environ vingt-quatre heures, si bien que les dates anciennes sont souvent vides. C'est un outil de rejeu et de pédagogie, pas un instrument.

## Open source — et un mot sur l'IA

Le code est publié sous licence **AGPL-3.0**. Il a été développé avec l'aide d'outils d'IA et relu à la main ; il reste quelques *glitchs*, j'en suis bien conscient. Les retours, signalements de bugs et contributions sont les bienvenus.

Code : https://github.com/s-celles/ogn-3d-viewer
Démo : https://s-celles.github.io/ogn-3d-viewer/