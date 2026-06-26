# OGN 3D Viewer

*Lire en [anglais / English](README.md).*

**Rejeu 3D des vols de planeurs de l'[Open Glider Network](http://wiki.glidernet.org/) (OGN), directement dans le navigateur.**

👉 **Démo en ligne : https://s-celles.github.io/ogn-3d-viewer/**

Choisissez un aérodrome (code OACI) et une date : le visualiseur reconstruit les
traces des planeurs de la journée sur un relief 3D — avec lecture animée, vue
subjective (cockpit) et un affichage tête haute indiquant le cap, l'altitude et
le vario.

![OGN 3D Viewer](https://img.shields.io/badge/statut-en%20ligne-brightgreen) ![Sans build](https://img.shields.io/badge/build-aucun-blue)

## Fonctionnalités

- **Recherche d'aérodrome** par code OACI avec autocomplétion.
- **Relief 3D** avec imagerie satellite et exagération verticale réglable.
- **Lecture temporelle** avec curseur d'heure de la journée et vitesses 1× / 8× / 30× / 120×.
- **Deux vues :** vue d'ensemble (dessus) et vue subjective (cockpit).
- **Modes caméra cockpit :** suivi du cap ou regard libre.
- **Modes d'affichage des traces :** historique, historique + futur, ou fenêtre glissante.
- **Affichage tête haute (HUD) :** cap, altitude et vario du planeur suivi.
- **Interface bilingue** (français / anglais), détectée automatiquement selon le navigateur.
- **Raccourcis clavier :** `V` changer de vue, `1/2/3` choisir un planeur, `Espace` lecture/pause, flèches pour pivoter/incliner/zoomer.

## Fonctionnement

Il s'agit d'un **unique fichier HTML statique** ([`index.html`](index.html)) — pas
de backend, pas d'étape de build. Il utilise :

- [deck.gl](https://deck.gl/) pour le rendu du relief 3D et des traces ;
- l'API publique [OGN FlightBook](https://flightbook.glidernet.org/) pour le
  carnet de vol et les traces IGC (appelée directement depuis le navigateur —
  l'API expose un CORS ouvert) ;
- les tuiles d'élévation AWS Terrarium et l'imagerie Esri World Imagery pour le relief.

## Limites des données

Les données OGN sont issues de la communauté et présentent quelques limites —
également affichées dans l'application via le bouton ⓘ :

- Les traces dépendent de la réception par les stations au sol : trous, décrochages ou montées tronquées possibles.
- Seuls les aéronefs **enregistrés et « suivis »** dans la base OGN apparaissent ; les appareils anonymes ou non équipés sont absents.
- La position est interpolée entre les balises reçues — ce n'est pas exactement la trajectoire réellement volée.
- L'altitude GNSS est affichée sur un relief en MSL : léger flottement possible près du sol (écart géoïde de plusieurs dizaines de mètres).
- Aucune donnée d'attitude : la caméra ne s'incline pas dans les virages.
- **OGN ne conserve les traces IGC que ~24 h**, les dates anciennes n'ont donc souvent aucune donnée rejouable.

Merci de consulter et de respecter la
[politique d'usage des données OGN](https://www.glidernet.org/ogn-data-usage/).

## Lancer en local

Comme tout s'exécute côté client, vous pouvez simplement ouvrir le fichier — mais
un petit serveur web local évite les restrictions file:// du navigateur :

```bash
git clone https://github.com/s-celles/ogn-3d-viewer.git
cd ogn-3d-viewer
python -m http.server 8000
# puis ouvrez http://localhost:8000/
```

## Déploiement

Le site est publié sur **GitHub Pages** automatiquement par le workflow GitHub
Actions [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) à chaque
push sur `main`.

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
