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

1. **Frage-Phase:** Moderator:in sieht Frage + echte Antwort, liest laut vor
2. **Antwort-Phase:** alle außer Moderator:in tippen eine erfundene Antwort (max. 140 Zeichen)
3. **Abstimm-Phase:** alle außer Moderator:in sehen alle Antworten gemischt (inkl. der
   echten) und wählen genau eine aus (mit Bestätigungs-Button, um Verklicken zu vermeiden)
4. **Auflösung:** echte Antwort wird markiert, wer wen worauf reingelegt hat
5. **Spielbrett:** animierte Bewegung aller Spielfiguren entsprechend der Punkte
6. Moderatorrolle wandert zum nächsten Spieler, neue Runde beginnt

## Spieleranzahl

- Minimum: 3 Spieler (sonst kein Start möglich)
- Maximum: aktuell nicht technisch begrenzt, aber nur 6 Spielfiguren verfügbar →
  praktisches Limit von 6 Spielern pro Raum

## Spielfiguren

Aktuell 6 auswählbare Platzhalter-Symbole, pro Raum ist jede Figur nur einmal vergebbar:

🦊 Fuchs · 🐢 Schildkröte · 🦄 Einhorn · 🦁 Löwe · 🐼 Panda · 🦉 Eule

*(Platzhalter – finale Symbole/Design folgen später)*

---

## Fragen-Verwaltung

Unter `/admin.html` (z. B. `https://dein-link.onrender.com/admin.html`) gibt es eine separate
Verwaltungsseite, getrennt von der Spieler-App:

- **Zugangscode:** Standard ist `bedazzled-admin`. Auf Render änderbar über die Umgebungsvariable
  `ADMIN_KEY` (Dashboard → Environment). Unbedingt ändern, bevor die App breiter geteilt wird –
  sonst kann jeder mit dem Link auch Fragen bearbeiten.
- **Einzeln hinzufügen/bearbeiten/löschen:** direkt über die Oberfläche
- **Massen-Import:** ein Eintrag pro Zeile im Format `Frage?;Echte Antwort`
- **Export:** Button lädt die aktuelle `questions.json` herunter

**Wichtig zu wissen:** Änderungen über `/admin.html` werden zwar sofort im laufenden Server
gespeichert, aber **nicht automatisch ins GitHub-Repo übernommen**. Bei einem neuen Deploy
(z. B. nach einem Code-Update) wird die Datei wieder auf den Stand im Repo zurückgesetzt.
Deshalb: Nach größeren Fragen-Updates über den Export-Button die neue `questions.json`
herunterladen und im Repo überschreiben, damit die Änderungen dauerhaft bleiben.

## Änderungsprotokoll

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
