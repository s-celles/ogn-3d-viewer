// ============ i18n ============
import { S } from './state';
import type { Lang } from './types';

interface Strings {
  [key: string]: string | string[];
  disc: string[];
}

export const I18N: Record<Lang, Strings> = {
  fr: {
    h1: 'OGN — rejeu 3D',
    sub: 'Choisissez un aérodrome (OACI) et une date, puis « Charger ».',
    airfieldLabel: 'Aérodrome (OACI)', dateLabel: 'Date', loadBtn: 'Charger',
    today: "Aujourd'hui", yesterday: 'Hier', collapse: 'Réduire le panneau', expand: 'Afficher le panneau',
    live: '🔴 En direct', liveExit: 'Quitter le direct', liveLabel: 'EN DIRECT',
    loading: 'Chargement…', searching: 'Recherche…',
    noFlights: 'Aucune trace exploitable ce jour.', errLoad: 'Erreur de chargement.',
    flights: 'trace(s)', tracksNote: '⚠ Les traces OGN ne sont gardées que ~24 h.',
    localTz: 'locale', view: 'Vue', overview: "Vue d'ensemble", fpv: 'Vue subjective', chase: 'Caméra poursuite',
    camera: 'Caméra', follow: 'Suivre le cap', free: 'Libre', subject: 'Planeur suivi', bank: "Inclinaison de l'horizon", sound: 'Son du vario',
    pause: '⏸ Pause', play: '▶ Lecture', timeOfDay: 'Heure de la journée',
    exo: 'Exagération du relief vertical :', gaze: 'Regard (assiette caméra) :',
    freeHint: 'Glissez pour regarder autour · la caméra reste sur le planeur.',
    defaultView: '↺ Vue par défaut',
    shortcuts: 'Raccourcis : V = changer de vue · 1/2/3 = choisir le planeur',
    trace: 'Trace', traceHist: 'Historique (passé)', traceHistFut: 'Historique + futur',
    traceWindow: 'Fenêtre glissante', windowLabel: 'Fenêtre (min) :',
    smooth: 'Lissage (spline)', varioComp: 'Vario compensé (énergie totale)', on: 'Activé', off: 'Désactivé',
    legendTitle: 'Planeurs (clic = isoler / choisir le sujet)',
    navCap: 'Glisser : déplacer · Ctrl ou clic-droit + glisser : pivoter / incliner · molette : zoom',
    northUp: 'Nord en haut', rotL: 'Pivoter vers la gauche', rotR: 'Pivoter vers la droite',
    tiltTop: 'Redresser (vue du dessus)', tiltGround: 'Incliner (vue rasante)',
    zoomOut: 'Reculer (dézoomer)', zoomIn: 'Avancer (zoomer)',
    hdg: 'Cap', alt: 'Altitude', vario: 'Vario', landed: 'posé', beforeTk: 'décollage à venir', min: 'min',
    info: 'Limites / à propos', disclaimerTitle: "Limites d'affichage", sourceCode: 'Code source',
    disc: [
      'Données OGN : la trace dépend de la réception par les stations au sol — trous, décrochages ou montées tronquées possibles.',
      'Seuls les aéronefs enregistrés et « suivis » dans la base OGN apparaissent ; les appareils anonymes ou non équipés sont absents.',
      "La position est interpolée entre les balises reçues : ce n'est pas exactement la trajectoire réellement volée.",
      'Altitude GNSS affichée sur un relief en MSL : léger flottement possible près du sol (écart géoïde de plusieurs dizaines de mètres).',
      "L'attitude des planeurs (inclinaison/assiette) est estimée à partir du taux de virage, de la vitesse et du vario — ce n'est pas une mesure réelle. Traces IGC conservées ~24 h par OGN.",
      "Le vario compensé (énergie totale) utilise la vitesse sol GPS faute de vitesse air : exact seulement par vent nul, biaisé par le vent.",
      "Usage des données : voir la <a href='https://www.glidernet.org/ogn-data-usage/' target='_blank' rel='noopener' style='color:var(--accent)'>politique d'usage des données OGN</a>.",
    ],
  },
  en: {
    h1: 'OGN — 3D replay',
    sub: 'Pick an airfield (ICAO) and a date, then “Load”.',
    airfieldLabel: 'Airfield (ICAO)', dateLabel: 'Date', loadBtn: 'Load',
    today: 'Today', yesterday: 'Yesterday', collapse: 'Collapse panel', expand: 'Show panel',
    live: '🔴 Live', liveExit: 'Exit live', liveLabel: 'LIVE',
    loading: 'Loading…', searching: 'Searching…',
    noFlights: 'No usable track that day.', errLoad: 'Loading error.',
    flights: 'track(s)', tracksNote: '⚠ OGN tracks are only kept for ~24 h.',
    localTz: 'local', view: 'View', overview: 'Overview', fpv: 'Cockpit view', chase: 'Chase cam',
    camera: 'Camera', follow: 'Lock to heading', free: 'Free look', subject: 'Followed glider', bank: 'Horizon banking', sound: 'Vario sound',
    pause: '⏸ Pause', play: '▶ Play', timeOfDay: 'Time of day',
    exo: 'Vertical terrain exaggeration:', gaze: 'Gaze (camera tilt):',
    freeHint: 'Drag to look around · the camera stays on the glider.',
    defaultView: '↺ Default view',
    shortcuts: 'Shortcuts: V = switch view · 1/2/3 = pick glider',
    trace: 'Track', traceHist: 'History (past)', traceHistFut: 'History + future',
    traceWindow: 'Rolling window', windowLabel: 'Window (min):',
    smooth: 'Smoothing (spline)', varioComp: 'Compensated vario (total energy)', on: 'On', off: 'Off',
    legendTitle: 'Gliders (click = isolate / pick subject)',
    navCap: 'Drag: pan · Ctrl or right-drag: rotate / tilt · wheel: zoom',
    northUp: 'North up', rotL: 'Rotate left', rotR: 'Rotate right',
    tiltTop: 'Level out (top-down)', tiltGround: 'Tilt (oblique)',
    zoomOut: 'Zoom out', zoomIn: 'Zoom in',
    hdg: 'Heading', alt: 'Altitude', vario: 'Vario', landed: 'landed', beforeTk: 'before takeoff', min: 'min',
    info: 'Limitations / about', disclaimerTitle: 'Display limitations', sourceCode: 'Source code',
    disc: [
      'OGN data: the track depends on ground-station reception — gaps, dropouts or truncated climbs are possible.',
      'Only aircraft registered and “tracked” in the OGN database appear; anonymous or non-equipped aircraft are missing.',
      'Position is interpolated between received beacons: it is not exactly the path actually flown.',
      'GNSS altitude shown over MSL terrain: slight floating near the ground is possible (geoid offset of tens of metres).',
      'Glider attitude (bank/pitch) is estimated from turn rate, speed and vario — not a real measurement. OGN keeps IGC tracks for ~24 h.',
      'The compensated (total-energy) vario uses GPS ground speed in place of airspeed: exact only in still air, biased by wind.',
      "Data usage: see the <a href='https://www.glidernet.org/ogn-data-usage/' target='_blank' rel='noopener' style='color:var(--accent)'>OGN data usage policy</a>.",
    ],
  },
};

// Translate a key using the current language, falling back to French then the key.
export const t = (k: string): string => {
  const v = (I18N[S.lang] && I18N[S.lang][k]) ?? I18N.fr[k] ?? k;
  return Array.isArray(v) ? v.join(' ') : v;
};
