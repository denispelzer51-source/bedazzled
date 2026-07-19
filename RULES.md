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

- Spielfeld hat Felder von 0 bis 20 (Zielfeld = 20)
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

🦊 Fuchs · 🐢 Schildkröte · 🦄 Einhorn · 🦁 Löwe · 🐼 Panda · 🦉 Eule

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

**Auslöser:** Türkis markierte Felder auf dem Spielbrett (aktuell Feld 4, 8, 12, 16 von 20).
Landet nach der Punktevergabe irgendein Spieler exakt auf einem dieser Felder, ist die
**nächste** Runde automatisch eine Schätzen-Karte statt einer normalen Bluff-Frage – für
alle Spieler gemeinsam, nicht nur für den, der dort gelandet ist.

Schätzen-Fragen werden getrennt von den Bluff-Fragen verwaltet: `/admin.html` hat dafür
einen eigenen Tab ("🔢 Schätzen-Fragen"), Daten liegen in `estimate_questions.json`.

*Als Nächstes geplant: Zeichnen-Karten als dritte Kategorie (Pictionary-Stil).*

## Fragen-Pool & Kategorien

Recherchiert nach dem Vorbild von Nobody is Perfect (Ravensburger), aber komplett eigene,
neu geschriebene Fragen – keine einzige Frage wurde aus dem Originalspiel übernommen.
Struktur orientiert sich an deren drei bewährten Kartentypen:

- **Kuriositäten:** Warum-Fragen zu einem ungewöhnlichen Ereignis/Brauch/Phänomen
- **Fremdwörter:** Was bedeutet ein bestimmtes (selteneres) Wort wirklich?
- **Wahrheit oder Lüge:** Eine Aussage, auf die man mit "Wahr" oder "Falsch" antwortet

Aktuell 38 Bluff-Fragen (verteilt auf diese 3 Kategorien) + 8 Schätzen-Fragen (Kategorie
"Allgemeinwissen"). Die Kategorie ist rein organisatorisch für die Fragen-Verwaltung – im
Spiel selbst wird weiterhin zufällig aus dem gesamten Bluff- bzw. Schätzen-Pool gezogen,
unabhängig von der Kategorie.

Fragen-Verwaltung (`/admin.html`) zeigt Fragen jetzt **nach Kategorie gruppiert und
aufklappbar** an, statt alle auf einmal untereinander. Beim Hinzufügen/Bearbeiten kann eine
Kategorie frei vergeben werden (bestehende erscheinen als Vorschlag); der Massen-Import
unterstützt jetzt das Format `Kategorie;Frage;Antwort` pro Zeile.

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
