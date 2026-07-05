# OGN 3D Viewer — Anleitung

3D-Wiedergabe von Segelflügen des [Open Glider Network](http://wiki.glidernet.org/) (OGN), direkt im Browser. Wählen Sie einen Flugplatz und ein Datum — oder laden Sie eigene Tracks — und spielen Sie den Tag über 3D-Gelände ab, mit Wiedergabe, Cockpit-Ansicht und Head-up-Display.

## Daten laden

- **Spots entdecken** — die Schaltfläche „🌍 Spots entdecken“ öffnet einen Explorer berühmter Segelfluggebiete weltweit (Rekorde, Meisterschaften), nach **Kontinent-Tabs** gruppiert; ein Klick lädt den Ort. Die Liste ist nach Land und per Freitextsuche **filterbar** (gespeichert, mit **↺**-Reset), was auch die Kartenmarker filtert. Orte ohne FlightBook-Abdeckung sind abgedunkelt, aber weiterhin **nur als Gelände** erkundbar (über ihre Koordinaten). Sie ist zugleich die **Startseite** der App, beim Start angezeigt (außer bei einem `?icao=`-Deep-Link), mit Zugang zu Sprache, 📖-Anleitung und ⓘ-Infos.
- **Hotspots (live)** — der **🔥**-Tab durchsucht das OGN-Live-Netz weltweit und ordnet die Gebiete, in denen *gerade jetzt* die meisten Segelflugzeuge in der Luft sind — als Liste und als größenskalierte Punkte auf der Weltkarte; ein Klick **lädt den Flugplatz und seine Flüge des Tages** — auch nach einem **OGN-Empfänger** benannte Gebiete (ohne Flugplatzcode) werden zum nächstgelegenen FlightBook-Flugplatz aufgelöst (per Distanz geprüft). Die Liste ist **filter- und sortierbar** — nach Land, per Freitextsuche und nach Aktivität / Name / Land — und diese Einstellungen werden **gespeichert** (localStorage) mit einem **↺**-Reset. Der Scan selbst ist gedrosselt (gemeinsames Netz): die Kopfzeile zeigt, wie lange er zurückliegt, und die **↻**-Schaltfläche scannt erst nach 15 Minuten erneut. Es werden nur aggregierte Zählungen je Gebiet verwendet, niemals einzelne Luftfahrzeuge.
- **Flugplatzsuche** — nach Code (ICAO oder nationale/FAA-Kennung) mit Autovervollständigung, für ein bestimmtes Datum.
- **Live-Modus** — Echtzeitansicht, an die aktuelle Uhrzeit gebunden, aktualisiert aktive Segelflugzeuge alle 20 s (aktuelle Baken farbig, ältere abgedunkelt).
- **Lokaler Datei-Import** — ziehen Sie eigene **IGC- / GPX- / KML**-Tracks auf die Karte (oder wählen Sie sie aus; auch eine SeeYou-**`.cup`**-Wegpunktdatei — siehe *Points of Interest*), um sie ebenso abzuspielen, ohne OGN.

## Die Szene

- **3D-Gelände** mit Satellitenbildern und einstellbarer vertikaler Überhöhung.
- **Grundkarte** — Wahl der über das Gelände gelegten Ebene: **Esri**-Satellit, **OpenTopoMap** oder **OpenStreetMap** (die Wahl wird gespeichert).
- **Frankreich-Detail (IGN)** — *experimentell, standardmäßig aus*: über Frankreich ein viel feineres Gelände (IGN **RGE ALTI / LIDAR HD**) und **20-cm-BD-ORTHO**-Luftbilder (Géoplateforme, ohne Schlüssel), sonst globale Quellen. Zum Testen einschalten.
- **Bodenauflösung** — einstellbarer Detailgrad der Satellitenbilder (z13 bis z18).
- **Drei Ansichten** — Übersicht (von oben), Cockpit (Egoperspektive, der Horizont neigt sich in Kurven) und eine Verfolgerkamera.
- **Cockpit-Kamera** — Kurs folgen oder freie Sicht.
- **Head-up-Display (HUD)** — Kurs, Höhe und Vario des verfolgten Segelflugzeugs.
- **Gleitkegel** — ein optionaler Erreichbarkeitskegel um den Flugplatz (Gleitzahl, Sicherheitshöhe und Radius einstellbar).
- **Bodenschatten** — senkrecht nach unten (Positionsanzeige) oder in Sonnenrichtung geworfen.
- **Höhenvorhang** — ein durchscheinender Vorhang von jedem Track bis zum Boden.
- **Beschriftung je Luftfahrzeug** — Kennzeichen, Höhe, Geschwindigkeit, Vario, Kurs.
- **Points of Interest** — benannte **OpenStreetMap-Gipfel** rund um die Ansicht anzeigen (Mast + Höhe, einstellbare Dichte, Schriftgröße nach Bedeutung des Gipfels) und/oder eigene **SeeYou-`.cup`**-Wegpunkte importieren (Flugplätze, Wendepunkte, Hindernisse…). Jeder Punkt erhält ein **Symbol je Typ**: ✈ Flugplatz, ▽ Außenlandefeld, ▲ Gipfel/Pass, ✕ Hindernis (Mast, Turm), ◆ Landmarke.
- **2D-Minikarte** — eine flache Einschub-Karte (oben rechts) mit der gewählten Grundkarte sowie Spur und Position des verfolgten (bzw. in der Übersicht fokussierten) Luftfahrzeugs zur Orientierung; andere fliegende Luftfahrzeuge erscheinen als Punkte. Umschaltbar.
- **HUD in der Übersicht** *(optional, standardmäßig aus)* — das Telemetrie-Feld (Kennzeichen, Kurs, Geschwindigkeit, Höhe, Vario) des **fokussierten** Luftfahrzeugs auch in der Übersicht anzeigen. **J / K**, die **◀ / ▶** und **1 / 2 / 3** wechseln das fokussierte Luftfahrzeug (beim Verschieben der Ansicht übernimmt wieder das der Mitte nächste).
- **Nur aktive Luftfahrzeuge** *(optional, standardmäßig aus)* — nur gerade **fliegende** Luftfahrzeuge zeigen und durchschalten; blendet die übrigen Spuren und Legendenzeilen aus (nie das verfolgte).
- **Luftmasse** *(optional, standardmäßig aus, experimentell)* — rekonstruiert die **Thermik des Tages** aus den Spuren (Kreisen + Steigen) und zeigt sie als **Schläuche** mit **Cumulus** an einer gemeinsamen Basis, in den Wind geneigt. Wolkenbasis und Wind werden per Wettermodell (**Open-Meteo**) verfeinert, sonst aus den Spuren geschätzt. **Sehr grobes Modell** (siehe *Hinweise & Grenzen*).

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
- **Vario-Ton** — ein optionaler Steig-/Sink-Ton für das verfolgte Segelflugzeug.
- **Verkehrsbewusstsein** — ein kurs-oben-Radar naher Luftfahrzeuge oder eine direktionale Kollisionswarnung.

## Einstellungen & Leistung

- **Gespeicherte Einstellungen** — Ihre Präferenzen (Ansichten, Effekte, Überhöhung, Sprache usw.) werden lokal gespeichert und beim nächsten Besuch wiederhergestellt; die Schaltfläche **↺** setzt sie auf die Standardwerte zurück.
- **Cache-Größe** — ein Faktor (×0,5 bis ×4) auf die Speicher- **und** Festplatten-Caches; die geschätzte Belegung wird im **ⓘ**-Panel angezeigt. Die Standardwerte richten sich bereits nach dem Gerätespeicher (großzügiger am Desktop).
- **Installierbare App (PWA)** — installierbar und **offline** nutzbar; bereits besuchte Kacheln bleiben über Sitzungen hinweg erhalten.
- **Sprachen** — Französisch, Englisch, Deutsch, Spanisch, Italienisch (automatisch erkannt).

- **Teilbare Links** — die **🔗**-Schaltfläche kopiert einen Link, der den genauen Zustand wiederherstellt: Flugplatz, Datum, Live/Wiedergabe, **Ansicht** (Übersicht/Cockpit/Verfolger), verfolgtes Luftfahrzeug, Geschwindigkeit und **Zeitpunkt** der Wiedergabe. Das **ⓘ**-Panel zeigt zudem einen **QR-Code** des aktuellen Links — scannen Sie ihn, um dieselbe Ansicht auf dem Handy zu öffnen.

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

- Die **Luftmasse** (aus den Spuren rekonstruierte Thermik) und die **Wetter**-Anreicherung (Wolkenbasis, Wind) sind **sehr grobe Modelle**, nur zur Veranschaulichung — weder gemessen noch vorhersagend.
- OGN-Spuren hängen vom Empfang der Bodenstationen ab — Lücken und Aussetzer sind möglich.
- Die Fluglage (Quer-/Längsneigung) wird aus Bodenspur und Geschwindigkeit **geschätzt**, nicht gemessen.
- OGN speichert IGC-Spuren nur **~24 Stunden**, ältere Daten sind daher oft leer.
- Bitte beachten Sie die [OGN-Datennutzungsrichtlinie](https://www.glidernet.org/ogn-data-usage/).

Die App ist eine clientseitige Single-Page-App; Quellcode und Fehlermeldungen auf [GitHub](https://github.com/s-celles/ogn-3d-viewer).
