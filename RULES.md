# Bedazzled – Regelwerk

Dieses Dokument hält alle Spielregeln fest, so wie sie aktuell im Code umgesetzt sind.
Es wird bei jeder Regeländerung aktualisiert und mit hochgeladen – dient nur als
Referenz-Dokumentation und wird von der App selbst nicht eingelesen.

Letzte Aktualisierung: 18. Juli 2026

---

## Grundprinzip

Ein Spieler ist pro Runde **Moderator:in** (rotiert automatisch reihum). Er/sie liest
eine Frage vor, für die es eine "echte", aber sehr ungewöhnliche Antwort gibt. Alle
anderen Spieler denken sich eine möglichst überzeugende, aber falsche Antwort aus.
Anschließend stimmen alle (außer dem/der Moderator:in) ab, welche der gemischten
Antworten die echte ist.

## Punkteregeln (Stand: aktuell im Code umgesetzt)

| Ereignis | Punkte |
|---|---|
| Du errätst die **echte Antwort** | **+3 Punkte** |
| Ein anderer Spieler fällt auf **deine erfundene Antwort** rein (wählt sie) | **+2 Punkte pro getäuschtem Spieler** |
| Du fällst auf die erfundene Antwort eines anderen rein | 0 Punkte |
| Der/die Moderator:in (liest nur vor, gibt keine Antwort ab, stimmt nicht ab) | 0 Punkte in dieser Runde |

**Beispiel:** 4 Spieler, davon 3 tippen Antworten. Deine erfundene Antwort wird von
2 der 3 anderen Spieler ausgewählt → du bekommst 2 × 2 = **4 Punkte**. Zusätzlich,
falls du selbst (als einer der Ratenden in einer anderen Rolle) die echte Antwort
richtig erraten hast, kommen +3 Punkte oben drauf.

## Spielfeld

- Spielfeld hat Felder von 0 bis 26 (Zielfeld = 26)
- Wer das Zielfeld zuerst erreicht oder überschreitet, gewinnt sofort
- Nach jeder Runde: Positionen werden auf dem animierten Spielbrett gezeigt, bevor es
  in die nächste Runde geht

## Rollen & Ablauf pro Runde

1. **Antwort-Phase:** Frage wird direkt allen angezeigt (Moderator:in liest sie laut vor und
   sieht zusätzlich die echte Antwort); alle außer Moderator:in tippen eine erfundene Antwort
   (max. 140 Zeichen). Moderator:in sieht live mit, was jede:r gerade eintippt.
2. **Abstimm-Phase:** alle außer Moderator:in sehen alle Antworten gemischt (inkl. der
   echten) und wählen genau eine aus (mit Bestätigungs-Button, um Verklicken zu vermeiden)
3. **Auflösung:** echte Antwort wird markiert, wer wen worauf reingelegt hat
4. **Spielbrett:** animierte Bewegung aller Spielfiguren entsprechend der Punkte
5. Moderatorrolle wandert zum nächsten Spieler, neue Runde beginnt

## Spieleranzahl

- Minimum: 3 Spieler (sonst kein Start möglich)
- Maximum: aktuell nicht technisch begrenzt, aber nur 6 Spielfiguren verfügbar →
  praktisches Limit von 6 Spielern pro Raum

## Spielfiguren

Aktuell 6 auswählbare Platzhalter-Symbole, pro Raum ist jede Figur nur einmal vergebbar:

💎 Diamant · 🎭 Maske · 🔮 Kristallkugel · 🃏 Joker · 👑 Krone · ⭐ Stern

*(Platzhalter – finale Symbole/Design folgen später)*

---

## Kartenkategorien

Neben den normalen Bluff-Fragen gibt es jetzt eine zweite Kategorie:

**Schätzen-Karten:** Statt eine erfundene Antwort abzugeben, tippt jeder eine **Zahl** als
Schätzung (z. B. "Wie viele Stufen hat der Eiffelturm?"). Kein Bluffen, kein Voting – wer am
nächsten an der echten Zahl liegt, gewinnt direkt Punkte:

| Platz | Punkte |
|---|---|
| 1. (am nächsten dran) | 3 Punkte |
| 2. | 2 Punkte |
| 3. | 1 Punkt |
| Alle weiteren | 0 Punkte |

**Auslöser:** Türkis markierte Felder auf dem Spielbrett (aktuell Feld 5, 8, 13, 18 von 26).
Landet nach der Punktevergabe irgendein Spieler exakt auf einem dieser Felder, ist die
**nächste** Runde automatisch eine Schätzen-Karte statt einer normalen Bluff-Frage – für
alle Spieler gemeinsam, nicht nur für den, der dort gelandet ist.

Schätzen-Fragen werden getrennt von den Bluff-Fragen verwaltet: `/admin.html` hat dafür
einen eigenen Tab ("🔢 Schätzen-Fragen"), Daten liegen in `estimate_questions.json`.

*Als Nächstes geplant: Zeichnen-Karten als dritte Kategorie (Pictionary-Stil).*

## Aufholjagd-Bonus

Sobald irgendein Spieler Feld 18 erreicht oder überschreitet, bekommt der/die aktuell
Letztplatzierte **einmalig pro Spiel** einen automatischen Bonus von **+5 Feldern**
(bei Gleichstand mehrerer Letzter: alle bekommen den Bonus). Der Bonus ist gedeckelt und
kann allein nicht zum Sieg führen (max. Feld 25 von 26). Ziel: das Spiel bleibt bis zum
Schluss spannend, auch wenn jemand früh stark in Führung geht.

## Fragen-Pool & Kategorien

Aktuell **100 Bluff-Fragen** in 3 komplett eigenen Kategorien (keine einzige Frage aus dem
Originalspiel übernommen):

- **Kuriositäten** (35 Fragen): Warum-Fragen zu einem ungewöhnlichen Ereignis/Brauch/Phänomen
- **Fremdwörter** (25 Fragen): Was bedeutet ein bestimmtes (selteneres) Wort wirklich?
- **Historischer Kontext** (40 Fragen): Fragen zu bekannten Personen aus Wissenschaft,
  Literatur, Musik und Geschichte (z.B. "Warum wurde Schriftsteller X fast hingerichtet?")

Plus 8 Schätzen-Fragen (Kategorie "Allgemeinwissen"). Die Kategorie ist rein organisatorisch
für die Fragen-Verwaltung – im Spiel selbst wird zufällig aus dem gesamten jeweiligen Pool
gezogen, unabhängig von der Kategorie.

**Rotation:** Jede Frage wird pro Raum nur einmal gezogen (kein Wiederholen), bis der
komplette Pool einmal durchgespielt wurde – danach startet die Rotation automatisch von
vorne. Gilt getrennt für Bluff-Fragen und Schätzen-Fragen.

Fragen-Verwaltung (`/admin.html`) zeigt Fragen nach Kategorie gruppiert und aufklappbar an.

## Fragen-Verwaltung

Unter `/admin.html` (z. B. `https://dein-link.onrender.com/admin.html`) gibt es eine separate
Verwaltungsseite, getrennt von der Spieler-App:

- **Zugangscode:** Standard ist `bedazzled-admin`. Auf Render änderbar über die Umgebungsvariable
  `ADMIN_KEY` (Dashboard → Environment). Unbedingt ändern, bevor die App breiter geteilt wird –
  sonst kann jeder mit dem Link auch Fragen bearbeiten.
- **Einzeln hinzufügen/bearbeiten/löschen:** direkt über die Oberfläche
- **Massen-Import:** ein Eintrag pro Zeile im Format `Kategorie;Frage?;Echte Antwort`
- **Export:** Button lädt die aktuelle `questions.json` herunter

**Wichtig zu wissen:** Änderungen über `/admin.html` werden zwar sofort im laufenden Server
gespeichert, aber **nicht automatisch ins GitHub-Repo übernommen**. Bei einem neuen Deploy
(z. B. nach einem Code-Update) wird die Datei wieder auf den Stand im Repo zurückgesetzt.
Deshalb: Nach größeren Fragen-Updates über den Export-Button die neue `questions.json`
herunterladen und im Repo überschreiben, damit die Änderungen dauerhaft bleiben.

## Änderungsprotokoll

- **19.07.2026:** Wiedereinstieg nach Verbindungsverlust ohne gespeicherte Sitzung (z.B. Tab
  komplett geschlossen, App beendet, neues Gerät): Versucht jemand mitten im laufenden Spiel
  über "Raum beitreten" mit einem Namen einzusteigen, der zu einem gerade getrennten Spieler
  passt, fragt die App nach: "Bist du das?" – nach Bestätigung übernimmt die Person exakt
  deren Platz samt Position, Punkten und Rolle, ganz ohne Neustart. Ein noch aktiv verbundener
  Spieler kann auf diesem Weg nicht "gekapert" werden (nur getrennte Plätze sind übernehmbar).
- **19.07.2026:** Drei wichtige Korrekturen: (1) Dopplungs-Auflösung korrigiert – der
  Moderator wählt jetzt tatsächlich zwischen "echte Antwort behalten" (Spieler-Version raus)
  oder "Spieler-Version behalten" (offizielle Antwort raus), sodass exakt einer von beiden
  gleichwertigen Einträgen im Spiel bleibt, kein erzwungenes Neuschreiben mehr.
  (2) Refresh-Bug behoben: Lud jemand die Seite mitten in der Antwort- oder Abstimm-Phase
  neu, wurden Eingabefelder und Auswahl fälschlich zurückgesetzt, obwohl der Spieler schon
  abgestimmt/geantwortet hatte – das führte zu auseinanderlaufenden Spielständen zwischen den
  Spielern. Der Server teilt jetzt den eigenen Abgabestatus mit, der Client stellt ihn nach
  einem Reload korrekt wieder her. (3) Alle Moderator-Aktionen (Abstimmung starten, Auflösen,
  Spielbrett zeigen, nächste Runde) sind jetzt auch serverseitig auf den Moderator beschränkt
  – vorher war das nur eine Anzeige-Einschränkung im Browser, die z.B. auf iOS umgangen
  werden konnte.
- **19.07.2026:** Drei größere Anpassungen an Antwort- und Abstimm-Phase: (1) Bei Bluff-Runden
  geht's jetzt automatisch zur Abstimmung über, sobald alle Mitspieler geantwortet haben –
  kein manueller Klick des Moderators mehr nötig. (2) Der Moderator sieht während der
  Abstimmung jetzt durchgehend die vollständige Liste aller Antwortmöglichkeiten, nicht nur
  wer schon abgestimmt hat. (3) Antworten, die (fast) identisch mit der echten Antwort sind,
  werden nicht mehr automatisch abgelehnt – der Spieler kann sie ganz normal einreichen.
  Stattdessen bekommt der Moderator eine Auflösungs-Ansicht mit zwei Optionen: die Antwort
  löschen (Spieler muss neu schreiben) oder behalten (zählt beim Abstimmen als Treffer auf
  die echte Antwort, ohne Bluff-Bonus für den Autor). Der automatische Rundenwechsel wartet,
  bis diese Entscheidung getroffen wurde.
- **19.07.2026:** Drei weitere Anpassungen: (1) Verbindungsaufbau robuster gemacht – Timeout
  auf 45 Sekunden erhöht (Render-Kaltstart kann bis zu 50 Sekunden dauern) und sichtbare
  Fehlermeldung bei Verbindungsproblemen, inkl. Hinweis, den Link ggf. aus dem WhatsApp-
  eigenen Browser heraus im echten Browser zu öffnen (bekanntes iOS-Problem). (2) Moderator-
  Text in der Antwort-Phase gekürzt ("Du bist Moderator:in. Hier siehst du live, wer was
  schreibt:"). (3) Eingereichte Antworten können jetzt geändert werden, solange noch nicht
  alle Mitspieler abgeschickt haben – sobald der letzte Spieler fertig ist, werden alle
  Eingabefelder automatisch gesperrt.
- **19.07.2026:** Drei Feinschliffe: (1) Bei der Auflösung stehen jetzt die konkreten Namen
  der getäuschten Mitspieler dabei, statt nur einer Anzahl ("🎣 Anna, Ben sind darauf
  reingefallen!" statt "2 Mitspieler sind reingefallen"). (2) Spielbrett-Zugsound ersetzt –
  klingt jetzt nach einer Spielfigur, die aufs Brett gesetzt wird (gefiltertes Rauschen +
  tiefer Klopfton), statt nach einem einfachen Rechteck-Piepton. (3) Ruckeliges Verhalten
  behoben, wenn eine ziehende Figur zu einer bereits stehenden dazukommt – der Versatz
  zwischen mehreren Figuren auf einem Feld wird jetzt sauber mitanimiert statt hart zu
  springen.
- **19.07.2026:** Vier neue Features: (1) Sieger-Ehrung am Spielende – neben dem Gewinner
  werden bis zu 3 Auszeichnungen angezeigt ("🎭 Bester Bluffer", "🙈 Meist Getäuscht",
  "🎯 Schätz-Ass"), jeweils nur wenn tatsächlich jemand die Bedingung erfüllt hat, bei
  Gleichstand mehrere Namen. (2) Dezente Soundeffekte (per Web Audio erzeugt, keine
  externen Dateien): leiser Ton beim Abschicken von Antwort/Stimme, Doppelton bei der
  Auflösung, leises Klack-Geräusch pro Spielbrett-Zug, kleine Melodie beim Sieg.
  (3) Dark/Light-Umschalter oben rechts (🌙/☀️), Einstellung wird im Browser gespeichert.
  (4) Dezentes Warn-Banner, falls ein Mitspieler während der Runde die Verbindung verliert
  ("Verbindungsprobleme bei ... – das Spiel läuft trotzdem normal weiter"), ohne das Spiel
  zu unterbrechen.
- **19.07.2026:** Host-Rolle eingeführt (der Raum-Ersteller, unabhängig von der rotierenden
  Moderatorrolle). Nur der Host sieht in der Lobby einen 🚫-Button neben jedem anderen
  Spieler, um ihn zu entfernen – mit zweistufiger Bestätigung ("wirklich entfernen?" →
  "Ja, entfernen"/"Abbrechen"), damit niemand versehentlich rausgeworfen wird. Entfernte
  Spieler bekommen eine Meldung und landen zurück auf dem Startbildschirm. Verlässt der
  Host selbst den Raum, wandert die Host-Rolle automatisch zum nächsten verbliebenen Spieler.
- **19.07.2026:** Startbildschirm umsortiert: "Raum beitreten" steht jetzt oben und wirkt
  optisch auffälliger (dickerer lila Rahmen, gefülltes Feld), "Neuen Raum erstellen" steht
  darunter und dezenter – da die meisten Spieler einem Raum beitreten statt selbst einen zu
  erstellen.
- **19.07.2026:** Geteilter Link enthält jetzt den Raum-Code als URL-Parameter
  (`?room=1234`). Öffnet jemand den Link, wird der Code automatisch ausgefüllt und der
  Fokus direkt ins Namensfeld gesetzt – nur noch Name eintippen und "Beitreten" klicken,
  kein manuelles Code-Abtippen mehr nötig.
- **19.07.2026:** Zwei Teilen-Buttons in der Lobby hinzugefügt: "🔗 Link kopieren" (kopiert
  die Browser-URL in die Zwischenablage) und "💬 Per WhatsApp teilen" (öffnet WhatsApp mit
  vorausgefüllter Nachricht inkl. Raum-Code und Link, Kontakt/Gruppe wird dort ausgewählt).
- **19.07.2026:** Großes Kuratieren: Nutzer hat das Fragen-Dokument durchgearbeitet und auf
  37 bestätigte Bluff-Fragen reduziert (14 Kuriositäten, 8 Fremdwörter, 15 Historischer
  Kontext). Alle nicht bestätigten Fragen aus dem Pool entfernt. Erkanntes Muster: bei
  Fremdwörtern werden nur wirklich seltene/unbekannte Begriffe akzeptiert (keine
  alltagsgeläufigen wie Empathie/Ironie/Rhetorik mehr); bei Kuriositäten/Geschichte werden
  konkrete, bildhafte Einzelszenen bevorzugt gegenüber abstrakten Fakten. Zwei versehentliche
  Fast-Dopplungen bereinigt (Darwin, da Vinci).
- **19.07.2026:** 7 neue Fragen aus vom Nutzer geliefertem Dokument integriert (Historischer
  Kontext: Tesla/leere Kiste, Victor Hugo/weggeschlossene Kleidung, Dalí/Löffel-Technik,
  Demosthenes/Kieselsteine, Bär Wojtek, Dickens/Bettausrichtung, Augustus/Gewitterangst).
  Eine gelieferte Frage (Beethoven/60 Kaffeebohnen) war bereits im Pool vorhanden und wurde
  nicht doppelt aufgenommen. Pool jetzt bei 107 Bluff-Fragen.
- **19.07.2026:** Spielfiguren an das Spielthema angepasst: statt zufälliger Tiere jetzt
  💎 Diamant, 🎭 Maske, 🔮 Kristallkugel, 🃏 Joker, 👑 Krone, ⭐ Stern (passt besser zu
  Bluff/Glitzer-Thema als die bisherigen Platzhalter-Tiere).
- **19.07.2026:** Lobby überarbeitet: Regelwerk ist jetzt ein aufklappbares Dropdown
  ("📖 Regelwerk anzeigen"), standardmäßig eingeklappt, damit die Spielerliste mehr Platz
  bekommt. Spielerliste selbst deutlich hervorgehoben (größere Schrift, größere Spielfigur,
  dezenter Lila-Rahmen um jede Zeile).
- **19.07.2026:** Neues Logo und Farbschema eingebunden – komplette Farbpalette aus dem neuen
  Logo übernommen (Void Black #04000A, Lila-Töne #330D98/#8C39F7/#AC58F9/#C577FB/#D5A1FB,
  Weiß #F7F1FA). Logo als Favicon und auf dem Startbildschirm eingebunden. Funktionale
  Signalfarben (Grün=richtig, Rot/Pink=falsch, Türkis=Schätzen-Feld) bewusst beibehalten,
  da sie unabhängig vom Marken-Look eine erkennbare Spiellogik-Bedeutung haben.
- **19.07.2026:** Auflösung zeigt jetzt konkrete Punktezahlen: eigene richtige Antwort mit
  "+3 Punkte"-Hinweis, und bei jeder erfundenen Antwort ein Hinweis, wie viele Mitspieler
  darauf reingefallen sind samt der dafür gewonnenen Punkte für den Autor/die Autorin.
- **19.07.2026:** Zweite Überarbeitung von "Historischer Kontext": nicht mehr nur spielerischer
  formuliert, sondern komplett andere, wirklich überraschende Fakten (z.B. Einsteins
  gestohlenes Gehirn, Newtons Nadel im Auge, Napoleons Kaninchen-Attacke) statt bloßer
  biografischer Zusammenfassungen – Ziel: "Das gibt's doch nicht"-Effekt statt Lexikon-Ton.
- **19.07.2026:** Neue Aufholjagd-Regel: sobald jemand Feld 18 erreicht/überschreitet,
  bekommt der/die Letztplatzierte einmalig automatisch +5 Bonusfelder (gedeckelt, kann
  nicht allein zum Sieg führen). Mit goldenem Banner bei der Auflösung angekündigt.
- **19.07.2026:** Alle 40 "Historischer Kontext"-Fragen umformuliert – gleiche Fakten, aber
  deutlich verspielter und neugieriger im Ton (angelehnt an den echten Nobody-is-Perfect-Stil,
  keine Frage übernommen), statt trocken-biografischer Wikipedia-Formulierungen.
- **19.07.2026:** Sechs Verbesserungen: (1) Zurück-Pfeil in der Lobby, um einen versehentlich
  erstellten Raum zu verlassen und stattdessen einem anderen beizutreten. (2) Moderator:in
  sieht jetzt auch bei Schätzen-Karten live, was eingetippt wird (vorher nur bei Bluff-Fragen).
  (3) Auflösung bei Schätzen-Karten zeigt jetzt "🎯 Am nächsten dran!" beim besten Tipp.
  (4) Beim Spielbrett ziehen mehrere Spielfiguren jetzt nacheinander statt gleichzeitig.
  (5) Eine allein auf einem Feld stehende Spielfigur wird jetzt zentriert statt versetzt
  dargestellt, nur bei mehreren Figuren auf einem Feld gibt es einen Versatz. (6) Moderator:in
  sieht bei der Abstimmung jetzt live, welche Antwort ein Spieler gerade antippt, bevor final
  abgeschickt wurde.
- **19.07.2026:** Nur die/der Moderator:in kann eine Runde starten (Button vorher fälschlich
  für alle sichtbar, jetzt auch serverseitig abgesichert). Türkise-Felder-Hinweis über dem
  Start-Button entfernt (steht bereits im Regelwerk-Panel). Mehr Kontrast zwischen Antwort
  und Spielername bei der Auflösung (Name jetzt als kleine Pille auf eigener Zeile). Die
  Mini-Spielbrett-Leiste zeigt neue Positionen jetzt erst, sobald das große animierte
  Spielbrett angezeigt wird, statt die Bewegung vorher schon zu verraten.
- **19.07.2026:** Spielfeld auf 26 Felder erweitert (vorher 20). Schätzen-Trigger-Felder auf
  5/8/13/18 geändert (bewusst unregelmäßiges statt gleichmäßiges Muster). Regelwerk-Text im
  Grundprinzip korrigiert (auch zufälliges Treffen der echten Antwort möglich, nicht nur
  Erfinden). Hinweis "automatisch korrigiert" für Mitspieler entfernt (unnötige Information).
  Alle 100 Antworten nochmal überarbeitet: deutlich kürzer und knackiger, wie ein Mitspieler
  es tatsächlich eintippen würde, statt ausführlicher Lexikon-Erklärungen.
- **19.07.2026:** Kategorie "Wahrheit oder Lüge" entfernt (war Namens-Übernahme aus dem
  Originalspiel), stattdessen neue Kategorie "Historischer Kontext" (Fragen zu bekannten
  Personen aus Wissenschaft/Literatur/Musik/Geschichte). Fragen-Pool auf 100 Bluff-Fragen
  aufgestockt (35 Kuriositäten, 25 Fremdwörter, 40 Historischer Kontext).
- **19.07.2026:** Bug behoben: Schätzen-Karten wurden fälschlich in jeder Folgerunde erneut
  ausgelöst, wenn ein Spieler bereits (aus einer früheren Runde) auf einem türkisen Feld
  stand, statt nur bei frischer Landung. Wirkte wie ein zufälliges Auslösen.
- **19.07.2026:** Regelwerk wird jetzt direkt in der App angezeigt (Lobby-Screen, während auf
  weitere Spieler gewartet wird) – strukturiert nach Grundprinzip, Punkten, Schätzen-Karten,
  Spielfeld, Rundenablauf.
- **19.07.2026:** Diagnose-Logging für "Raum nicht gefunden"-Fehler ergänzt (Server-Logs
  zeigen jetzt aktive Raum-Codes bei jedem Erstellen/fehlgeschlagenen Beitreten).
- **18.07.2026:** Alle echten Antworten der Bluff-Fragen umformuliert: keine Gedankenstriche,
  Anführungszeichen, Doppelpunkte oder Semikolons mehr – klingen jetzt so, wie ein Mitspieler
  es natürlich ins Handy tippen würde, statt wie ein Lexikon-Eintrag. Grund: Erfundene
  Antworten sollen sich vom Stil her nicht mehr von der echten Antwort unterscheiden lassen.
- **18.07.2026:** Fragen-Pool massiv erweitert (38 Bluff-Fragen in 3 Kategorien nach
  Ravensburger-Vorbild: Kuriositäten/Fremdwörter/Wahrheit-oder-Lüge, alle komplett neu
  geschrieben). Admin-Bereich zeigt Fragen jetzt nach Kategorie gruppiert und aufklappbar an.
- **18.07.2026:** Test-Simulator unter `/simulator.html` hinzugefügt – simuliert 3-6
  Mitspieler nebeneinander in einem Browser-Tab (je ein unabhängiges Fenster), damit neue
  Funktionen getestet werden können, ohne mehrere echte Geräte offen zu haben.
- **18.07.2026:** Größeres, zentriertes Eingabefeld für Schätzen-Karten (vorher zu klein/schlecht platziert).
- **18.07.2026:** Erfundene Antworten, die zu ähnlich zur echten Antwort sind (Tippfehler-
  Varianten, Kernbegriff aus der echten Antwort abgeschrieben, o.ä.), werden beim Absenden
  automatisch abgelehnt – der Spieler bekommt eine Meldung und kann direkt neu formulieren.
  Erkennt Ähnlichkeit im Wortlaut, aber keine komplett andersformulierten Sinn-Duplikate
  (dafür bräuchte es eine KI-basierte Prüfung, aktuell nicht eingebaut).
- **18.07.2026:** Separate Frage-Phase entfernt – Mitspieler sehen die Frage jetzt direkt in
  der Antwort-Phase, Moderator:in sieht dort auch schon die echte Antwort. Zusätzlich sieht
  die/der Moderator:in in Echtzeit, was die anderen gerade eintippen (auch vor dem Absenden),
  mit "tippt gerade …"-Kennzeichnung, solange noch nichts final abgeschickt wurde.
- **18.07.2026:** Zweite Kartenkategorie "Schätzen-Karten" hinzugefügt (Zahlen-Schätzung,
  Top-3-Punktevergabe 3/2/1). Türkise Spielbrett-Felder (4/8/12/16) lösen automatisch eine
  Schätzen-Runde statt einer Bluff-Frage aus. Eigene Verwaltung im Admin-Bereich.
- **18.07.2026:** Eingereichte Antworten werden automatisch auf Rechtschreibung/Grammatik
  geprüft und korrigiert (LanguageTool-API), bevor sie gespeichert werden – damit Tippfehler
  nicht verraten, welche Antwort erfunden ist. Bei API-Ausfall wird der Originaltext verwendet.
- **18.07.2026:** Moderator:in sieht während der Antwort-Phase live alle eingereichten
  Antworten samt Namen; Board-Darstellung nicht mehr abgeschnitten (Ränder korrigiert);
  Auflösung zeigt jedem Spieler grün/rot, ob die eigene Wahl richtig war, samt Autor:in
- **18.07.2026:** Fragen-Verwaltung unter `/admin.html` hinzugefügt (hinzufügen, bearbeiten,
  löschen, Massen-Import per Textformat, Export als Datei)
- **18.07.2026:** Punkte angepasst – richtige Antwort erraten: 3 Punkte (vorher 2),
  pro getäuschtem Mitspieler: 2 Punkte (vorher 3)
- **18.07.2026:** Spielfiguren-Auswahl von 3 auf 6 erweitert, Mehrfachvergabe pro Raum gesperrt
- **Ursprüngliche Version:** 3 Spielfiguren, richtige Antwort = 2 Punkte, getäuschter
  Mitspieler = 3 Punkte pro Person

---

## Offene Punkte / noch zu klären

- Verhalten bei Gleichstand mehrerer Spieler auf Zielfeld in derselben Runde
- Verhalten, falls Moderator:in während der Runde disconnected
- Endgültiges Design der Spielfiguren
- Fragenkatalog: aktuell 8 Testfragen in `questions.json`, muss vor "Launch" erweitert werden
