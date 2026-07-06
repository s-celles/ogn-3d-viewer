# OGN 3D Viewer — Guide

Rejeu 3D des vols de planeurs de l'[Open Glider Network](http://wiki.glidernet.org/) (OGN), directement dans le navigateur. Choisissez un aérodrome et une date — ou chargez vos propres traces — et rejouez la journée sur un relief 3D, avec lecture animée, vue cockpit et affichage tête haute.

## Chargement des données

- **Découvrir des spots** — le bouton « 🌍 Découvrir des spots » ouvre un explorateur des sites de vol à voile réputés du monde (records, championnats), classés par **onglets de continent** ; un clic charge le site. La liste est **filtrable** par pays et par recherche libre (persistée, avec une remise à zéro **↺**), ce qui filtre aussi les marqueurs de la carte. Les sites hors couverture FlightBook sont grisés mais restent explorables en **terrain seul** (via leurs coordonnées). C'est aussi la **page d'accueil** de l'appli, ouverte au démarrage (sauf lien direct `?icao=`) et donnant accès à la langue, au guide 📖 et aux infos ⓘ.
- **Points chauds (direct)** — l'onglet **🔥** scanne le réseau OGN en direct dans le monde entier et classe les zones où le plus de planeurs volent *en ce moment*, sous forme de liste et de points dimensionnés sur la carte du monde ; un clic **charge l'aérodrome et sa journée de vols** — même les zones nommées d'après un **récepteur OGN** (sans code aérodrome) sont résolues vers l'aérodrome FlightBook le plus proche (vérifié par la distance). La liste est **filtrable et triable** — par pays, par recherche libre, et par activité / nom / pays — et ces préférences sont **enregistrées** (localStorage) avec une remise à zéro **↺**. Le scan lui-même est limité (réseau partagé) : l'en-tête indique depuis quand il date et le bouton **↻** ne relance qu'au bout de 15 minutes. Seuls des décomptes agrégés par zone sont utilisés, jamais des aéronefs individuels.
- **Scan d'onde** — l'onglet **🌊** classe les spots connus par **potentiel d'onde de ressaut** pour la date choisie : il récupère en une requête le vent d'altitude et la stabilité (Open-Meteo) et note chaque site (vent traversier × stabilité, avec une longueur d'onde plausible). *La météo d'abord, le terrain ensuite* — cliquez un site pour le charger un jour d'onde prometteur.
- **Recherche d'aérodrome** — par code (OACI ou identifiant national/FAA) avec autocomplétion, pour une date donnée.
- **Mode direct** — vue temps réel épinglée à l'heure courante, rafraîchissant les planeurs actifs toutes les 20 s (balises récentes en couleur, plus anciennes atténuées).
- **Import de fichiers locaux** — glissez ou choisissez vos propres traces **IGC / GPX / KML** (ou un fichier de points **`.cup`** SeeYou — voir *Points d'intérêt*) pour les rejouer de la même façon, sans passer par OGN.

## La scène

- **Relief 3D** avec imagerie satellite et exagération verticale réglable.
- **Fond de carte** — choix de la couche drapée sur le relief : satellite **Esri**, **OpenTopoMap** ou **OpenStreetMap** (le choix est enregistré).
- **Détail France (IGN)** — *expérimental, désactivé par défaut* : sur la France, remplace le relief par un MNT bien plus fin (IGN **RGE ALTI / LIDAR HD**) et l'imagerie par la **BD ORTHO 20 cm** (Géoplateforme, sans clé), avec repli sur les sources mondiales ailleurs. À activer pour tester.
- **Résolution du sol** — niveau de détail de l'imagerie satellite réglable (z13 à z18).
- **Trois vues** — vue d'ensemble (dessus), vue cockpit (subjective, l'horizon s'incline dans les virages) et caméra poursuite qui suit le planeur.
- **Caméra cockpit** — suivi du cap ou regard libre.
- **Affichage tête haute (HUD)** — cap, altitude et vario du planeur suivi.
- **Cône de finesse** — un cône d'atteignabilité optionnel autour de l'aérodrome (finesse, hauteur de sécurité et rayon réglables).
- **Ombres au sol** — projetées à la verticale (indicateur de position) ou selon la direction du soleil.
- **Rideau d'altitude** — un voile translucide reliant chaque trace au sol.
- **Étiquettes par aéronef** — immatriculation, altitude, vitesse, vario, cap.
- **Points d'intérêt** — affichez les **sommets nommés** d'OpenStreetMap autour de la vue (piquet + altitude, densité réglable, taille du texte selon l'importance du sommet), et/ou importez vos **waypoints SeeYou `.cup`** (aérodromes, points de virage, obstacles…). Chaque point reçoit une **icône selon son type** : ✈ aérodrome, ▽ vachable, ▲ sommet/col, ✕ obstacle (antenne, pylône), ◆ repère.
- **Mini-carte 2D** — une carte plate en incrustation (coin haut-droit) avec le fond de carte choisi, la trace et la position de l'aéronef suivi (ou focalisé en vue d'ensemble), pour se repérer ; les autres aéronefs en vol y figurent en points. Activable.
- **HUD en vue d'ensemble** *(option, désactivée par défaut)* — afficher le bandeau (immat, cap, vitesse, altitude, vario) de l'aéronef **focalisé** aussi en vue d'ensemble. **J / K**, les **◀ / ▶** et **1 / 2 / 3** changent l'aéronef focalisé (le déplacement de la vue rend la main au « plus proche du centre »).
- **Aéronefs actifs seulement** *(option, désactivée par défaut)* — n'afficher et ne faire défiler que les aéronefs **en vol à l'instant courant** ; masque les autres traces et lignes de légende (jamais celui que vous suivez).
- **Masse d'air** *(option, désactivée par défaut, expérimental)* — reconstruit les **thermiques du jour** à partir des traces (spirales + montées) et les représente en **panaches** coiffés de **cumulus** à une base commune, inclinés au vent. Base des nuages et vent affinés par un modèle météo (**Open-Meteo**) quand disponible, sinon estimés depuis les traces. Les **montées d'onde** (droites, bien au-dessus du relief) sont aussi reconstruites, en **rubans verticaux** — ce que la détection de thermiques (spirales) ignore. **Modèle très approximatif** (voir *Notes & limites*).
- **Potentiel de portance** *(option, désactivée par défaut, expérimental)* — estime par la physique **où l'air monte** : **thermique** (soleil × pente du relief × flux de chaleur → w\*, avec albédo/Bowen par type de sol OSM et ombres portées), **portance de pente** (vent × relief) et **convergence** (vent × courbure du relief : l'air s'accumule aux têtes de vallée et confluences), chaque composante **s'active par une case à cocher**, puis les composantes actives se **dosent par un mélangeur simplexe** dont la forme suit leur nombre (un axe pour 2, un triangle pour 3, un polygone au-delà — thermique, pente, convergence, onde) : plus on approche un sommet, plus sa composante domine. Champ chaud (ça monte) / bleu (ça descend) drapé sur le relief, cohérent en couleur entre composantes. Les jours à **cumulus**, les cœurs thermiques les plus forts sont coiffés d'un **cumulus** à la base des nuages (rien un jour bleu). Une **légende couleur** dans le panneau relie la palette à descend/monte, avec un repère Vz pour le thermique. Un panneau **structure du jour** (émagramme : sondage, particule, base des nuages, plafond — avec la profondeur convective et cumulus/bleu) aide à lire la journée. **Modèle très approximatif** (voir *Notes & limites*).
- **Vent** *(option, désactivée par défaut, expérimental)* — visualise le champ de vent, **local et affiné par le relief**, décliné **par altitude** (profil météo Open-Meteo). Un menu déroulant choisit la représentation : **Drapé (2D)** en 3 variantes (vecteurs, couleurs par la vitesse, ou les deux), **Barbules (2D)** (convention météo : demi-trait 5 kt, trait plein 10 kt, fanion 50 kt), **Isotaches (2D)** (contours d'iso-vitesse + bandes colorées), **Couches d'altitude (3D)**, **Anneaux par altitude (3D)**, **Hodographe (3D)** (spirale du profil → cisaillement). Une **rose** (coin) donne vitesse et provenance. **Très approximatif** (voir *Notes & limites*).

## Lecture

- **Lecture temporelle** — curseur d'heure de la journée, lecture **avant et arrière**, préréglages 0,25× / 1× / 4× / 8× / 30×, et un champ de vitesse libre pour toute autre valeur (ex. 0,5×, 120×).
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

## Réglages & performance

- **Réglages mémorisés** — vos préférences (vues, effets, exagération, langue, etc.) sont enregistrées localement et restaurées à la prochaine visite ; le bouton **↺** les remet aux valeurs par défaut.
- **Taille du cache** — un multiplicateur (×0,5 à ×4) sur les caches mémoire **et** disque ; l'estimation d'occupation est affichée dans le panneau **ⓘ**. Les valeurs par défaut s'adaptent déjà à la mémoire de l'appareil (plus généreuses sur ordinateur).
- **Application installable (PWA)** — installable et utilisable **hors ligne** ; les tuiles déjà visitées sont conservées entre les sessions.
- **Langues** — français, anglais, allemand, espagnol, italien (détection automatique).

- **Liens partageables** — le bouton **🔗** copie un lien qui rouvre l'état exact : aérodrome, date, direct/rejeu, **vue** (ensemble/subjective/poursuite), aéronef suivi, vitesse et **instant** de lecture. Le panneau **ⓘ** affiche aussi un **QR code** du lien courant — scannez-le pour ouvrir la même vue sur mobile.

## Mode développeur

Ajoutez `?dev=1` à l'URL pour un panneau technique : **fil de fer** du relief, **relief nu** (sans imagerie), overlay **FPS**, **compteurs de cache**, et réglages de streaming (nombre de requêtes, densité du maillage, taille des caches, distance de vue). `?dev=0` le désactive.

## Raccourcis clavier

- **V** — changer de vue
- **1 / 2 / 3** — choisir un planeur
- **J / K** — planeur précédent / suivant
- **Espace** — lecture / pause (avant)
- **B** — lecture / pause arrière
- **Flèches** — pivoter / incliner / zoomer

## Notes & limites

- **Masse d'air — modèle très approximatif, purement illustratif** (ni mesuré ni prédictif ; à ne pas utiliser pour préparer un vol) :
  - *Thermiques* — montrés uniquement là où un planeur a réellement **spiralé** (sans trafic, rien) ; position et force = la **montée du planeur**, pas le mouvement réel de l'air (pas de *netto*) ; les ascendances faibles ou brèves peuvent être ratées. Les **montées d'onde** (rubans) sont détectées par l'inverse — montée soutenue et **droite** au-dessus du relief — et peuvent confondre un long vol de pente avec de l'onde.
  - *Base des nuages* — **estimée** (LCL depuis température/humidité, ou percentile des sommets), non mesurée : erreur possible de plusieurs centaines de mètres.
  - *Vent* — vent **local** (météo à maille large au centre de la vue, ou dérive des cercles), **affiné par le relief** (abri/déflexion, heuristique) et décliné **par altitude** via le profil ; reste grossier (ignore rotors, convergences, brises, conservation de masse). Les représentations 3D sont **expérimentales**.
  - *Potentiel de portance* — estimation **physique**, pas une mesure, superposition des composantes cochées. *Thermique* (w\*) : albédo/Bowen approchés (land‑cover OSM, indispo si Overpass ne répond pas → uniforme), avec **ombres portées** du relief en amont mais pas d'ombre des cumulus ni d'advection ; **champ moyen**, contraste maximal **soleil bas**. Sa profondeur suit le **plafond thermique** (particule de surface vs le radiosondage Open-Meteo, sinon le sommet de la couche limite) — plus profond au-dessus des terrains bas, **s'estompant par temps stable** et s'arrêtant au-dessus de la couche limite. **Indépendant du point de vue** (une pente garde sa couleur quand la caméra bouge) : le chaud suit la **force absolue** de l'ascendance (un thermique fort de midi ressort en rouge là où il est fort), le bleu marque les cellules **sous le sol plat de référence** (faces à l'ombre / mal exposées) — **subsidence compensatoire** (conservation de la masse), pas une dégueulante mesurée. Une case **Calibrer sur les traces** (optionnelle) recale l'intensité sur les **montées observées** du jour (un facteur d'échelle global) — désactivée par défaut, car un facteur global peut atténuer de bonnes pentes simplement dépourvues de trafic. *Pente* (`w = vent · ∇relief`, affiné par une heuristique d'abri au vent) : **approximation cinématique au 1er ordre** ignorant décollements, rotors, ondes de ressaut et stabilité, avec un seul vent pour toute la scène et une finesse limitée par le MNT ; le bleu (chute) vient des **faces sous le vent**. *Convergence* (divergence d'un vent dévié par le relief, normalisée) : indice **cinématique** seul — pas de convergence thermique/de brise/synoptique, pas de conservation de masse, un seul vent ; chaud là où le flux s'accumule (têtes de vallée, confluences), bleu en aval.
- Les traces OGN dépendent de la réception par les stations au sol — trous et décrochages possibles.
- L'attitude (inclinaison/assiette) est **estimée** à partir de la trace sol et de la vitesse, non mesurée.
- L'OGN ne conserve les traces IGC qu'environ **24 h**, les dates anciennes sont donc souvent vides.
- Merci de respecter la [politique d'usage des données OGN](https://www.glidernet.org/ogn-data-usage/).

Pour la physique derrière la masse d'air et le potentiel de portance (formules, données, hypothèses), voir la [référence du modèle](lift-model.md) (en anglais).

L'application est une SPA côté client ; code source et signalements sur [GitHub](https://github.com/s-celles/ogn-3d-viewer).
