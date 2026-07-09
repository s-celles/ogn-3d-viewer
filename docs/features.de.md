# OGN 3D Viewer — Anleitung

3D-Wiedergabe von Segelflügen des [Open Glider Network](http://wiki.glidernet.org/) (OGN), direkt im Browser. Wählen Sie einen Flugplatz und ein Datum — oder laden Sie eigene Tracks — und spielen Sie den Tag über 3D-Gelände ab, mit Wiedergabe, Cockpit-Ansicht und Head-up-Display.

## Daten laden

- **Spots entdecken** — die Schaltfläche „🌍 Spots entdecken“ öffnet einen Explorer berühmter Segelfluggebiete weltweit (Rekorde, Meisterschaften), nach **Kontinent-Tabs** gruppiert; ein Klick lädt den Ort. Die Liste ist nach Land und per Freitextsuche **filterbar** (gespeichert, mit **↺**-Reset), was auch die Kartenmarker filtert. Orte ohne FlightBook-Abdeckung sind abgedunkelt, aber weiterhin **nur als Gelände** erkundbar (über ihre Koordinaten). Sie ist zugleich die **Startseite** der App, beim Start angezeigt (außer bei einem `?icao=`-Deep-Link), mit Zugang zu Sprache, 📖-Anleitung und ⓘ-Infos.
- **Hotspots (live)** — der **🔥**-Tab durchsucht das OGN-Live-Netz weltweit und ordnet die Gebiete, in denen *gerade jetzt* die meisten Segelflugzeuge in der Luft sind — als Liste und als größenskalierte Punkte auf der Weltkarte; ein Klick **lädt den Flugplatz und seine Flüge des Tages** — auch nach einem **OGN-Empfänger** benannte Gebiete (ohne Flugplatzcode) werden zum nächstgelegenen FlightBook-Flugplatz aufgelöst (per Distanz geprüft). Die Liste ist **filter- und sortierbar** — nach Land, per Freitextsuche und nach Aktivität / Name / Land — und diese Einstellungen werden **gespeichert** (localStorage) mit einem **↺**-Reset. Der Scan selbst ist gedrosselt (gemeinsames Netz): die Kopfzeile zeigt, wie lange er zurückliegt, und die **↻**-Schaltfläche scannt erst nach 15 Minuten erneut. Es werden nur aggregierte Zählungen je Gebiet verwendet, niemals einzelne Luftfahrzeuge.
- **Wellen-Scan** — der **🌊**-Tab ordnet die bekannten Spots nach **Leewellen-Potenzial** für das gewählte Datum: er holt in einer Sammelanfrage den Höhenwind und die Stabilität (Open-Meteo) und bewertet jeden Ort (Querwind × Stabilität × plausible Wellenlänge × das **Relief** des Orts und ob der **Wind einen Kamm quert** — Ebenen werden verworfen, und ein Ort mit mehreren Kämmen wird berücksichtigt). Er listet die Wellengelände und kennzeichnet jedes mit der **Tageschance** (nutzbar / möglich / gering), also nie leer. Jeder Ort in den Listen trägt zudem ein **Gelände-Tag** — Ebene 🌾 / Hügel 🏞 / Berge ⛰ / Hochgebirge 🏔 — klassifiziert nach **Kapos/Meybeck** aus der lokalen Höhenamplitude (≤ 12 km) und der Gipfelhöhe der Region (Hochgebirge ≥ 2500 m). Die Wellen-*Chance* ist separat, dynamisch. *Erst das Wetter, dann der Platz* — einen Ort anklicken, um ihn an einem vielversprechenden Wellentag zu laden.
- **Flugplatzsuche** — nach Code (ICAO oder nationale/FAA-Kennung) mit Autovervollständigung, für ein bestimmtes Datum.
- **Live-Modus** — Echtzeitansicht, an die aktuelle Uhrzeit gebunden, aktualisiert aktive Segelflugzeuge alle 20 s (aktuelle Baken farbig, ältere abgedunkelt).
- **Lokaler Datei-Import** — ziehen Sie eigene **IGC- / GPX- / KML**-Tracks auf die Karte (oder wählen Sie sie aus; auch eine SeeYou-**`.cup`**-Wegpunktdatei — siehe *Points of Interest* — oder eine XCSoar/LK8000-**`.plr`**-Segelflugzeugpolare — siehe *Netto-Vario*), um sie ebenso abzuspielen, ohne OGN.

## Die Szene

- **3D-Gelände** mit Satellitenbildern und einstellbarer vertikaler Überhöhung.
- **3D-Gebäude (OSM)** *(optional)* — extrudiert OpenStreetMap-Gebäudegrundrisse um die Ansicht: Wände (beleuchtet für Tiefe) + flache Dächer, Höhe aus den Tags `height` / `building:levels` (sonst Standard). „Autogen"-Stadtkontext — saubere extrudierte Blöcke, keine Photogrammetrie. Nur bei nahem Zoom (Stadtebene), radiusbegrenzt und gedeckelt für die Leistung; am besten in gut kartierten Regionen (z. B. Schweiz). Grob & illustrativ.
- **Grundkarte** — Wahl der über das Gelände gelegten Ebene: **Esri**-Satellit, **OpenTopoMap** oder **OpenStreetMap** (die Wahl wird gespeichert).
- **Frankreich-Detail (IGN)** — *experimentell, standardmäßig aus*: über Frankreich ein viel feineres Gelände (IGN **RGE ALTI / LIDAR HD**) und **20-cm-BD-ORTHO**-Luftbilder (Géoplateforme, ohne Schlüssel), sonst globale Quellen. Zum Testen einschalten.
- **Bodenauflösung** — einstellbarer Detailgrad der Satellitenbilder (z13 bis z18).
- **Drei Ansichten** — Übersicht (von oben), Cockpit (Egoperspektive, der Horizont neigt sich in Kurven) und eine Verfolgerkamera.
- **Cockpit-Kamera** — Kurs folgen oder freie Sicht.
- **Teleport (🛰)** — ein Dialog, der eine freie Beobachterkamera an einen beliebigen Ort setzt: **`Lat, Lon`** eingeben oder einen **Flugplatzcode** bzw. **Gipfel-/Wegpunktnamen** tippen und aus der **Autovervollständigung** wählen (kuratierte Spots, geladene Gipfel & Wegpunkte, aktueller Platz), eine **Höhe** (oder **über Grund**) und einen **Anfangskurs** festlegen und dorthin springen, um sich umzusehen (Ziehen zum Schwenken/Neigen). Das HUD zeigt Position, Höhe über Grund und den Wind dort. Funktioniert ohne geladenen Flug (ideal für die Wetter-Sandbox); eine Ansichts-Schaltfläche bringt zurück.
- **Head-up-Display (HUD)** — Kurs, Höhe, eine **Windfahne** auf Flughöhe, Vario — und optional **Netto / Super-Netto** — des verfolgten Segelflugzeugs.
- **Gleitkegel** — ein optionaler Erreichbarkeitskegel um den Flugplatz (Gleitzahl, Sicherheitshöhe und Radius einstellbar).
- **Bodenschatten** — senkrecht nach unten (Positionsanzeige) oder in Sonnenrichtung geworfen.
- **Höhenvorhang** — ein durchscheinender Vorhang von jedem Track bis zum Boden.
- **Beschriftung je Luftfahrzeug** — Kennzeichen, Höhe, Geschwindigkeit, Vario, Kurs.
- **Points of Interest** — benannte **OpenStreetMap-Gipfel** rund um die Ansicht anzeigen (Mast + Höhe, einstellbare Dichte, Schriftgröße nach Bedeutung des Gipfels) und/oder eigene **SeeYou-`.cup`**-Wegpunkte importieren (Flugplätze, Wendepunkte, Hindernisse…). Jeder Punkt erhält ein **Symbol je Typ**: ✈ Flugplatz, ▽ Außenlandefeld, ▲ Gipfel/Pass, ✕ Hindernis (Mast, Turm), ◆ Landmarke.
- **Nutzbare Pässe** *(optional)* — markiert die vom Wind **durchströmten** Pässe (DEM-Sättel), wo er sich staut (Venturi) und luvseitig Hangaufwind entsteht. Jeder zeigt einen kleinen Strömungs-Glyph über den Pass: er **steigt die Luvseite hinauf (grün = Aufwind, die nutzbare Seite)** und **sinkt dann auf der Leeseite (blau = Absinken/Rotor)**, damit die richtige Seite eindeutig ist. Erscheint nur, wo der Wind den Pass wirklich quert (reagiert also auf den simulierten Wind).
- **2D-Minikarte** — eine flache Einschub-Karte (oben rechts) mit der gewählten Grundkarte sowie Spur und Position des verfolgten (bzw. in der Übersicht fokussierten) Luftfahrzeugs zur Orientierung; andere fliegende Luftfahrzeuge erscheinen als Punkte. Umschaltbar.
- **HUD in der Übersicht** *(optional, standardmäßig aus)* — das Telemetrie-Feld (Kennzeichen, Kurs, Geschwindigkeit, Höhe, Vario) des **fokussierten** Luftfahrzeugs auch in der Übersicht anzeigen. **J / K**, die **◀ / ▶** und **1 / 2 / 3** wechseln das fokussierte Luftfahrzeug (beim Verschieben der Ansicht übernimmt wieder das der Mitte nächste).
- **Nur aktive Luftfahrzeuge** *(optional, standardmäßig aus)* — nur gerade **fliegende** Luftfahrzeuge zeigen und durchschalten; blendet die übrigen Spuren und Legendenzeilen aus (nie das verfolgte).
- **Luftmasse** *(optional, standardmäßig aus, experimentell)* — rekonstruiert die **Thermik des Tages** aus den Spuren (Kreisen + Steigen) und zeigt sie als **Schläuche** mit **Cumulus** an einer gemeinsamen Basis, in den Wind geneigt. Wolkenbasis und Wind werden per Wettermodell (**Open-Meteo**) verfeinert, sonst aus den Spuren geschätzt. **Wellensteigflüge** (gerade, weit über dem Gelände) werden ebenfalls rekonstruiert, als vertikale **Bänder** — was die Thermikerkennung (Kreisen) übersieht. **Sehr grobes Modell** (siehe *Hinweise & Grenzen*).
- **Aufwindpotenzial** *(optional, standardmäßig aus, experimentell)* — physikalische Schätzung, **wo die Luft steigt**: **Thermik** (Sonne × Hang × Wärmefluss → w\*, mit OSM-Landbedeckung Albedo/Bowen, Schlagschatten und einer **konvexen Auslöser-Gewichtung** — bevorzugt Grate und konvexe Hangkanten gegenüber der ebenen Fläche — und einem **diurnalen Bodenwärmespeicher**, dessen Trägheit je Oberfläche das Maximum in den Nachmittag verschiebt und Thermik über Fels/Stadt lange trägt, per Schieberegler einstellbar; an windig-konvektiven Tagen ordnet sich die Thermik in windparallele **Wolkenstraßen**), **Hangaufwind** (Wind × Gelände, plus eine **anabatische** Hangwind-Komponente an sonnigen Tagen, damit Grate auch bei Windstille tragen) und **Konvergenz** (Wind × Geländekrümmung: Luft staut sich an Talschlüssen und Zusammenflüssen, plus eine **See-/Landwind**-Front wenige km landeinwärts an heißen Tagen), jede Komponente wird **per Kontrollkästchen aktiviert**, dann werden die aktiven **mit einem Simplex-Mischpult dosiert**, dessen Form ihrer Anzahl folgt (eine Achse für 2, ein Dreieck für 3, ein Polygon darüber hinaus — Thermik, Hang, Konvergenz, Welle): je näher an einer Ecke, desto stärker diese Komponente. Warmes (steigt) / blaues (sinkt) Feld über das Gelände gelegt, farblich stimmig zwischen den Komponenten. An einem **Cumulustag** werden die stärksten Thermikkerne mit einem **Cumulus** an der Wolkenbasis gekrönt (an einem blauen Tag keine). Eine **Farblegende** im Panel ordnet die Skala Sinken/Steigen zu, mit einem Vz-Anker für die Thermik. Ein **Tagesstruktur**-Panel (Emagramm: Sondierung, Paket, Wolkenbasis, Obergrenze — mit konvektiver Tiefe und Cumulus/Blau) hilft, den Tag zu lesen. **Sehr grobes Modell** (siehe *Hinweise & Grenzen*).
- **Wind** *(optional, standardmäßig aus, experimentell)* — stellt das Windfeld dar, **lokal und durch das Gelände verfeinert**, nach **Höhe** aufgelöst (Open-Meteo-Profil). Ein Dropdown wählt die Darstellung: **Drapiert (2D)** in 3 Varianten (Pfeile, Geschwindigkeitsfarben, oder beides), **Windfahnen (2D)** (met. Konvention: halbe Fahne 5 kt, ganze 10 kt, Wimpel 50 kt), **Isotachen (2D)** (Linien gleicher Windstärke + Farbbänder), **Höhenschichten (3D)**, **Ringe pro Höhe (3D)**, **Hodograph (3D)** (Profilspirale → Scherung). Eine **Windrose** (Ecke) zeigt Geschwindigkeit und Herkunft. **Sehr grob** (siehe *Hinweise & Grenzen*).
- **Wetter-Sandbox** *(optional, standardmäßig aus)* — ersetzt das abgerufene Wetter durch eine **synthetische Atmosphäre** (Windgeschwindigkeit / -richtung / -scherung, Stabilität N, Bodentemperatur, Feuchte) und eine wählbare **Sonnen-Datum/-Zeit**, um „Was-wäre-wenn“-Situationen zu erkunden — z. B. einen Wellentag erzwingen und Onde-Bänder (mit zerrissenen **Rotor**-Wolken, die die Turbulenz tief unter den Kämmen markieren), Tagesstruktur-Emagramm und Wellen-Scan reagieren sehen. Speist **alle** physikalischen Modelle; **Presets** (Thermik- / Cumulus- / Hangflug- / Wellen- / Tiefsonnen-Tag, je eigene Atmosphäre) und ein Reset stehen bereit; ein **⚠ simuliert**-Banner markiert den Modus. Illustrativ, keine Vorhersage.

## Wiedergabe

- **Zeitwiedergabe** — Tageszeit-Regler, **Vorwärts- und Rückwärtswiedergabe**, Voreinstellungen 0,25× / 1× / 4× / 8× / 30× und ein Feld für jede andere Geschwindigkeit (z. B. 0,5×, 120×).
- **Spurmodi** — Verlauf, Verlauf + Zukunft, oder gleitendes Fenster.
- **Spureffekte** — einfach, Neon, Kondensstreifen oder Bloom.
- **Spurglättung** — Catmull-Rom-Spline-Interpolation für flüssige Bahnen.
- **Empfangslücken** — Intervalle ohne OGN-Bake werden interpoliert und gestrichelt gezeichnet.
- **Diagramme** — Höhe, Geschwindigkeit und Kurs im Zeitverlauf.

## Instrumente & Verkehr

- **Geschätzte Fluglage** — jedes Segelflugzeug neigt sich in Kurven und stellt sich nach der Eigengeschwindigkeit an.
- **Kompensiertes Vario** — Gesamtenergie-Vario als Standard (abschaltbar für die rohe Steigrate).
- **Netto & Super-Netto** *(optional, standardmäßig aus)* — die HUD-Anzeige mit dem Bedienelement **Netto (Luftmasse)** durchschalten. **Netto** ist die geschätzte **Vertikalgeschwindigkeit der Luftmasse**: das Gesamtenergie-Steigen minus das Eigensinken des Segelflugzeugs bei der aktuellen Geschwindigkeit, aus seiner **Polare** (`Netto = Vz,TE − Sinken(V)`). **Super-Netto** (relatives Netto) geht einen Schritt weiter und entfernt das **Kreisflug-(Mindest-)Sinken**, schätzt also das **im Kreisflug in dieser Luft erreichbare Steigen** (`Super = Netto − |Mindestsinken|`; > 0 → Anhalten und Kreisen lohnt sich). Die Polare nutzt das physikalische Zwei-Term-Modell `A·V³ + B/V` und ist standardmäßig eine **ASK 21**; importieren Sie die **`.plr`** (XCSoar/LK8000) Ihres Flugzeugs, um sie anzupassen. OGN liefert keine Fahrt, daher steht die **Grundgeschwindigkeit** für `V` — ein grober Anhaltspunkt (durch Wind und Kurven verfälscht), kein kalibriertes Netto.
- **Vario-Ton** — ein optionaler Steig-/Sink-Ton für das verfolgte Segelflugzeug.
- **Verkehrsbewusstsein** — ein kurs-oben-Radar naher Luftfahrzeuge oder eine direktionale Kollisionswarnung.

## Einstellungen & Leistung

- **Gespeicherte Einstellungen** — Ihre Präferenzen (Ansichten, Effekte, Überhöhung, Sprache usw.) werden lokal gespeichert und beim nächsten Besuch wiederhergestellt; die Schaltfläche **↺** setzt sie auf die Standardwerte zurück.
- **Cache-Größe** — ein Faktor (×0,5 bis ×4) auf die Speicher- **und** Festplatten-Caches; die geschätzte Belegung wird im **ⓘ**-Panel angezeigt. Die Standardwerte richten sich bereits nach dem Gerätespeicher (großzügiger am Desktop).
- **Installierbare App (PWA)** — installierbar und **offline** nutzbar; bereits besuchte Kacheln bleiben über Sitzungen hinweg erhalten.
- **Sprachen** — Französisch, Englisch, Deutsch, Spanisch, Italienisch (automatisch erkannt).

- **Teilbare Links** — die **🔗**-Schaltfläche kopiert einen Link, der den genauen Zustand wiederherstellt: Flugplatz, Datum, Live/Wiedergabe, **Ansicht** (Übersicht/Cockpit/Verfolger), verfolgtes Luftfahrzeug, Geschwindigkeit und **Zeitpunkt** der Wiedergabe. Das **ⓘ**-Panel zeigt zudem einen **QR-Code** des aktuellen Links — scannen Sie ihn, um dieselbe Ansicht auf dem Handy zu öffnen.
- **Bild-Export** — die **📷**-Schaltfläche lädt die aktuelle 3D-Szene als **PNG** (verlustfrei) oder **WebP** (kleiner — Format im Panel wählen) herunter. Passt zum **anonymen Modus** für teilbare Screenshots. Erfasst Karte/Gelände/Spuren; die DOM-Overlays (Beschriftungen, HUD, Minikarte) sind nicht enthalten.

## Entwicklermodus

Fügen Sie `?dev=1` zur URL hinzu für ein technisches Panel: Gelände-**Drahtgitter**, **nacktes Relief** (ohne Bilder), **FPS**-Overlay, **Cache-Zähler** und Streaming-Regler (Anfragenzahl, Netzdichte, Cache-Größen, Sichtweite). `?dev=0` schaltet ihn aus.

## Tastaturkürzel

- **V** — Ansicht wechseln
- **1 / 2 / 3** — Segelflugzeug wählen
- **J / K** — vorheriges / nächstes Segelflugzeug
- **Leertaste** — Wiedergabe / Pause (vorwärts)
- **B** — Wiedergabe / Pause rückwärts
- **Pfeiltasten** — drehen / neigen / zoomen

## Hinweise & Grenzen

- **Luftmasse — sehr grobes, rein illustratives Modell** (weder gemessen noch vorhersagend; nicht zur Flugvorbereitung):
  - *Thermik* — nur dort gezeigt, wo ein Flugzeug tatsächlich **kreiste** (kein Verkehr → nichts); Lage und Stärke sind das **Steigen des Flugzeugs**, nicht die echte Luftbewegung (kein *Netto*); schwache oder kurze Aufwinde können übersehen werden. **Wellensteigflüge** (Bänder) werden über das Gegenteil erkannt — ein anhaltender, **gerader** Steigflug über dem Gelände — und können einen langen Hangflug mit Welle verwechseln.
  - *Wolkenbasis* — **geschätzt** (LCL aus Temperatur/Feuchte oder Perzentil der Oberkanten), nicht gemessen: Abweichung von einigen hundert Metern möglich.
  - *Wind* — ein **lokaler** Wind (grobes Wettermodell in der Bildmitte oder Kreisdrift), **durch das Gelände verfeinert** (Abschirmung/Ablenkung, Heuristik) und nach **Höhe** aus dem Profil aufgelöst; bleibt grob (ignoriert Rotor, Konvergenz, Brisen, Massenerhaltung). Die 3D-Darstellungen sind **experimentell**.
  - *Aufwindpotenzial* — eine **physikalische** Schätzung, keine Messung, Überlagerung der aktivierten Komponenten. *Thermik* (w\*): näherungsweise Albedo/Bowen (OSM-Landbedeckung, ohne Overpass → uniform), mit **Schlagschatten** vom Gelände im Luv, aber ohne Cumulus-Beschattung/Advektion; ein **Ensemble-Mittel**, am deutlichsten bei **tiefer Sonne**. Seine Tiefe folgt der **thermischen Obergrenze** (Bodenpaket vs. Open-Meteo-Temperaturprofil, sonst die Grenzschichthöhe) — tiefer über niedrigem Gelände, **an einem stabilen Tag verblassend** und oberhalb der Grenzschicht endend. **Blickpunktunabhängig** (ein Hang behält seine Farbe, wenn die Kamera schwenkt): Warm folgt der **absoluten** Aufwindstärke (eine kräftige Mittagsthermik erscheint rot, wo sie stark ist), Blau markiert Zellen **unter der flachen Referenzfläche** (beschattete / schlecht exponierte Hänge) — **kompensierendes Absinken** (Massenerhaltung), kein gemessener Abwind. Ein optionales Kontrollkästchen **Auf Spuren kalibrieren** skaliert die Stärke auf die **beobachteten Steigwerte** des Tages (ein globaler Tagesfaktor) — standardmäßig aus, da ein globaler Faktor günstige Hänge ohne Verkehr abschwächen kann. *Hang* (`w = Wind · ∇Gelände`, verfeinert durch eine Luv-Abschattungsheuristik): eine **kinematische Näherung erster Ordnung**, die Strömungsablösung, Rotor, Leewellen und Stabilität ignoriert, mit einem Wind für die ganze Szene und durch die DEM begrenztem Detail; Blau (Abwind) von **Leehängen**. *Konvergenz* (Divergenz eines vom Gelände abgelenkten Windes, normiert): nur ein **kinematischer** Hinweis — keine thermische/Brisen-/synoptische Konvergenz, keine Massenkonsistenz, ein Wind für die Szene; warm, wo sich die Strömung staut (Talschlüsse, Zusammenflüsse), blau im Lee.
- OGN-Spuren hängen vom Empfang der Bodenstationen ab — Lücken und Aussetzer sind möglich.
- Die Fluglage (Quer-/Längsneigung) wird aus Bodenspur und Geschwindigkeit **geschätzt**, nicht gemessen.
- OGN speichert IGC-Spuren nur **~24 Stunden**, ältere Daten sind daher oft leer.
- Bitte beachten Sie die [OGN-Datennutzungsrichtlinie](https://www.glidernet.org/ogn-data-usage/).

Zur Physik hinter der Luftmasse und dem Aufwindpotenzial (Formeln, Daten, Annahmen) siehe die [Modellreferenz](lift-model.md) (auf Englisch); die Geländeklassifikation und der Wellen-Scan stehen in der [Standort-Klassifikationsreferenz](site-classification.md).

Die App ist eine clientseitige Single-Page-App; Quellcode und Fehlermeldungen auf [GitHub](https://github.com/s-celles/ogn-3d-viewer).
