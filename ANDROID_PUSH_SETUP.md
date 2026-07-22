# Push-Benachrichtigungen in Android Studio einrichten

Der Server (`push.js`) und die Web-App (`client.js`) sind bereits vorbereitet. Was jetzt noch
**in deinem Android-Studio-Projekt** gemacht werden muss (das kann ich hier nicht direkt
einbauen, da ich keinen Zugriff auf dein natives Projekt/Gradle-Setup habe):

## 1. Firebase-Projekt anlegen
1. Auf https://console.firebase.google.com ein neues Projekt erstellen (kostenlos)
2. Android-App hinzufügen mit deiner `applicationId` (aus `capacitor.config.json`: `com.bedazzled.app`)
3. Die generierte `google-services.json` herunterladen

## 2. In Android Studio einbauen
1. `google-services.json` nach `android/app/google-services.json` kopieren
2. In `android/build.gradle` (Projekt-Ebene), im `dependencies`-Block:
   ```gradle
   classpath 'com.google.gms:google-services:4.4.2'
   ```
3. In `android/app/build.gradle` (App-Ebene), ganz unten:
   ```gradle
   apply plugin: 'com.google.gms.google-services'
   ```

## 3. Capacitor-Plugin installieren
Im Projekt-Root (wo `package.json` liegt):
```bash
npm install @capacitor/push-notifications
npx cap sync android
```

## 4. Berechtigungen (Android 13+)
In `android/app/src/main/AndroidManifest.xml` sollte Capacitor das automatisch ergänzen,
zur Sicherheit prüfen ob vorhanden:
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

## 5. Firebase Admin SDK auf dem Server hinterlegen (für den echten Versand)
1. In der Firebase Console: Projekteinstellungen → Dienstkonten → "Neuen privaten Schlüssel generieren"
2. Den kompletten Inhalt der heruntergeladenen JSON-Datei als Render-Umgebungsvariable
   `FIREBASE_SERVICE_ACCOUNT_JSON` hinterlegen (Render Dashboard → Environment)
3. Fertig - `push.js` erkennt das automatisch und sendet echte Push-Nachrichten.
   Ohne diese Variable werden Push-Nachrichten nur ins Server-Log geschrieben (kein Fehler,
   einfach kein echter Versand - praktisch fürs Testen ohne Firebase).

## 6. Testen
1. `npx cap sync android` → Projekt in Android Studio öffnen → auf echtem Gerät ausführen
   (Push funktioniert nicht im Emulator ohne Google Play Services)
2. Im Spiel einer Lobby beitreten - im Server-Log sollte erscheinen:
   `[Push] Token registriert für Spieler "..." in Raum ...`
3. Runde starten → auf einem zweiten Gerät (nicht Moderator) die App in den Hintergrund schicken
   → sobald die Antwort-Phase beginnt, sollte eine Push-Nachricht "Du bist dran! 🎭" ankommen

## Was der Server aktuell an Push-Momenten auslöst
- **Antwort-Phase startet** → alle außer dem/der Moderator:in: "Du bist dran! Gib deine Bluff-Antwort ab."
- **Abstimm-Phase startet** → alle außer dem/der Moderator:in: "Du bist dran! Jetzt abstimmen."
- **Neue Runde vorbereitet** → neue:r Moderator:in: "Du bist dran! Du moderierst die nächste Runde."

Weitere Momente (z.B. "dein Zug beim Duplikat-Auflösen") lassen sich genauso einfach über
`push.notifyPlayers([...], title, body, data)` an beliebiger Stelle in `server.js` ergänzen.
