<p align="center"><img src="assets/banner.png" alt="OGN 3D Viewer" width="100%"></p>

# OGN 3D Viewer

*Lire en [anglais / English](README.md).*

**Rejeu 3D des vols de planeurs de l'[Open Glider Network](http://wiki.glidernet.org/) (OGN), directement dans le navigateur.**

👉 **Démo en ligne : https://s-celles.github.io/ogn-3d-viewer/**

Choisissez un aérodrome (code OACI) et une date : le visualiseur reconstruit les
traces des planeurs de la journée sur un relief 3D — avec lecture animée, vue
subjective (cockpit) et un affichage tête haute indiquant le cap, l'altitude et
le vario.

**Liens profonds :** l'aérodrome et la date peuvent être passés en paramètres
d'URL, par ex. `…/ogn-3d-viewer/?icao=LFBI&date=2024-06-01`, pour pointer
directement vers une journée (depuis le [carnet OGN FlightBook](https://flightbook.glidernet.org/)
par exemple). L'URL reste synchronisée au fil des chargements, et le panneau
d'info renvoie vers la page FlightBook correspondante.

![OGN 3D Viewer](https://img.shields.io/badge/statut-en%20ligne-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6) ![Bun](https://img.shields.io/badge/bundler-Bun-f9f1e1)

## Captures d'écran

<table>
  <tr>
    <td width="50%"><img src="assets/screencaptures/overview.png" alt="Vue d'ensemble"><br><sub><b>Vue d'ensemble</b> — les traces de la journée sur le relief 3D.</sub></td>
    <td width="50%"><img src="assets/screencaptures/cockpit.png" alt="Vue subjective"><br><sub><b>Vue subjective</b> (cockpit) avec l'affichage tête haute.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screencaptures/chase.png" alt="Caméra poursuite"><br><sub><b>Caméra poursuite</b> avec le modèle du planeur et l'indicateur anti-collision.</sub></td>
    <td width="50%"><img src="assets/screencaptures/graphs.png" alt="Graphes"><br><sub><b>Graphes</b> — altitude, vitesse et cap.</sub></td>
  </tr>
</table>

## Fonctionnalités

- **Chargement** — recherche d'aérodrome (code OACI ou national/FAA), **mode direct** temps réel, import **IGC / GPX / KML**, **découverte de spots** mondiaux par continent (records, championnats) — la liste est un [Tabular Data Package](data/spots.csv) maintenu par `just check-spots` — et **points chauds en direct** classant où les planeurs volent en ce moment.
- **Scène 3D** — relief avec imagerie satellite (résolution réglable), trois vues (ensemble, cockpit, poursuite), HUD, cône de finesse, ombres au sol, rideau d'altitude, étiquettes par aéronef.
- **Lecture** — curseur d'heure de la journée et vitesses 1× / 4× / 8× / 30× / 120×, modes de trace, effets (néon / contrail / bloom), lissage spline, graphes.
- **Instruments & trafic** — attitude estimée, vario compensé (énergie totale), son du vario, radar cap-en-haut ou anti-collision directionnel.
- **Application** — interface en **5 langues** (fr / en / de / es / it), liens partageables (site, date, vue, aéronef, vitesse, instant), **réglages persistants** (localStorage + reset), **PWA hors ligne** avec cache de tuiles réglable, raccourcis clavier, et un **mode développeur** (`?dev=1` : fil de fer, FPS, compteurs de cache…).

📖 **Guide détaillé des fonctionnalités** : bouton **📖** dans l'application, ou [`docs/features.fr.md`](docs/features.fr.md).

## Fonctionnement

Une **application monopage côté client**, écrite en **TypeScript** et empaquetée
avec **[Bun](https://bun.sh/)** — sans backend. Le code source se trouve dans
[`src/`](src/) sous forme de petits modules ES ([`igc.ts`](src/igc.ts) pour
l'analyse, [`flight-math.ts`](src/flight-math.ts) pour la géométrie,
[`terrain.ts`](src/terrain.ts), [`render.ts`](src/render.ts), [`ui.ts`](src/ui.ts),
un état partagé [`state.ts`](src/state.ts), etc.). Il utilise :

- [deck.gl](https://deck.gl/) (les paquets npm `@deck.gl/*`, tree-shakés) pour le
  rendu du relief 3D et des traces ;
- l'API publique [OGN FlightBook](https://flightbook.glidernet.org/) pour le
  carnet de vol et les traces IGC (appelée directement depuis le navigateur —
  l'API expose un CORS ouvert) ;
- les tuiles d'élévation AWS Terrarium et l'imagerie Esri World Imagery pour le relief.

Le [script de build](scripts/build.ts) émet également un manifeste d'application
web, des icônes et un service worker ([`sw.js`](scripts/build.ts)) : l'app est
servie « réseau d'abord » (un nouveau déploiement se met à jour dès que vous êtes
en ligne, et fonctionne hors ligne sinon), tandis que les tuiles de carte sont
mises en cache de façon persistante (« cache d'abord ») pour éviter de les
retélécharger. Les préférences vivent dans le `localStorage` (voir
[`settings.ts`](src/settings.ts)).

## Pile technique

- **TypeScript** (strict) — types métier pour les traces, l'API FlightBook et
  l'état partagé de l'application.
- **Bun** — bundler, serveur de développement et lanceur de tests, sans outillage
  séparé.
- **deck.gl 9** via les paquets scoped tree-shakés, et `upng-js` pour le décodage
  des tuiles de relief en pur JS.

## Développement

Nécessite [Bun](https://bun.sh/). Installez les dépendances une fois, puis :

```bash
git clone https://github.com/s-celles/ogn-3d-viewer.git
cd ogn-3d-viewer
bun install

bun run serve      # build + sert dist/ sur http://localhost:3000
bun run dev        # reconstruit dist/ à chaque modif (watch ; à coupler avec un serveur statique)
bun run build      # build de production (minifié) → dist/
bun test           # tests unitaires des modules purs (igc, flight-math)
bun run typecheck  # tsc --noEmit
```

`bun run serve` est le moyen rapide de voir l'application. Pour une boucle
d'édition à chaud, lancez `bun run dev` (reconstruit `dist/` à la sauvegarde)
dans un terminal et servez `dist/` dans un autre (ex. `python3 -m http.server -d dist 3000`).

> Note : on empaquette avec [`bun build`](https://bun.sh/docs/bundler) plutôt qu'avec
> le serveur de dev HTML intégré de Bun (`bun ./index.html`) — le découpage de
> modules à la volée de ce dernier résout mal le graphe deck.gl/luma et casse le
> maillage du relief. deck.gl et luma.gl sont épinglés en 9.1.0 (voir `overrides`
> dans [`package.json`](package.json)) car luma 9.3 a changé l'API de maillage dont
> dépend notre relief construit à la main.

## Limites des données

Les données OGN sont issues de la communauté et présentent quelques limites —
également affichées dans l'application via le bouton ⓘ :

- Les traces dépendent de la réception par les stations au sol : trous, décrochages ou montées tronquées possibles.
- Seuls les aéronefs **enregistrés et « suivis »** dans la base OGN apparaissent ; les appareils anonymes ou non équipés sont absents.
- La position est interpolée entre les balises reçues — ce n'est pas exactement la trajectoire réellement volée.
- L'altitude GNSS est affichée sur un relief en MSL : léger flottement possible près du sol (écart géoïde de plusieurs dizaines de mètres).
- Aucune donnée d'attitude n'est transmise : l'inclinaison/assiette affichée (et l'horizon qui s'incline) sont **estimées** à partir de la trace sol et de la vitesse, non mesurées.
- **OGN ne conserve les traces IGC que ~24 h**, les dates anciennes n'ont donc souvent aucune donnée rejouable.

Merci de consulter et de respecter la
[politique d'usage des données OGN](https://www.glidernet.org/ogn-data-usage/).

## Déploiement

Le site est publié sur **GitHub Pages** automatiquement par le workflow GitHub
Actions [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) à chaque
push sur `main` : il installe Bun, vérifie les types, lance les tests, construit
le dossier `dist/` et le publie. Les URL des ressources sont émises en relatif
(`--public-path=./`) afin que le build fonctionne sous le sous-chemin
`/ogn-3d-viewer/` du projet.

Pour l'activer sur un fork : allez dans **Settings → Pages → Build and deployment
→ Source** et choisissez **GitHub Actions**.

## Divulgation de l'usage de l'IA

Ce projet a été développé avec l'aide d'outils d'IA. L'IA a contribué à la
rédaction et à l'amélioration du code de l'application, du workflow de
déploiement et de cette documentation. Toutes les productions ont été relues par
un mainteneur humain avant publication.

## Licence

Sous licence **GNU Affero General Public License v3.0 (AGPL-3.0)** — voir
[`LICENSE`](LICENSE). En résumé : vous pouvez utiliser, modifier et redistribuer
ce code, mais si vous exploitez une version modifiée comme service en réseau,
vous devez en fournir le code source modifié à ses utilisateurs.

Les données OGN appartiennent à l'[Open Glider Network](http://wiki.glidernet.org/)
et à ses contributeurs.
