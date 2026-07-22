// push.js - Push-Benachrichtigungs-Grundgerüst (Android / Firebase Cloud Messaging)
//
// So funktioniert's:
// 1. In der Firebase Console ein Projekt anlegen, "Cloud Messaging" aktivieren
// 2. Unter Projekteinstellungen -> Dienstkonten -> "Neuen privaten Schlüssel generieren"
//    -> das ist die serviceAccount-JSON-Datei
// 3. Auf Render (oder lokal) als Env-Var FIREBASE_SERVICE_ACCOUNT_JSON den KOMPLETTEN
//    Inhalt dieser JSON-Datei als String hinterlegen (nicht committen!)
// 4. google-services.json in Android Studio ins app/-Verzeichnis legen (siehe
//    ANDROID_PUSH_SETUP.md)
//
// Ohne Konfiguration (z.B. lokale Entwicklung ohne Firebase-Zugang) passiert nichts
// Schlimmes - es wird nur geloggt, was gesendet WÜRDE. Kein Absturz, kein Blocker.

let admin = null;
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;
  try {
    admin = require('firebase-admin');
    let serviceAccount = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    }
    if (serviceAccount) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('[Push] Firebase Admin initialisiert - echter Push-Versand aktiv.');
    } else {
      admin = null;
      console.log('[Push] Kein FIREBASE_SERVICE_ACCOUNT_JSON gesetzt - Push-Nachrichten werden nur simuliert/geloggt.');
    }
  } catch (e) {
    admin = null;
    console.log('[Push] firebase-admin nicht installiert/konfiguriert - Push-Nachrichten werden nur simuliert/geloggt:', e.message);
  }
}

async function sendToToken(pushToken, title, body, data = {}) {
  init();
  if (!pushToken) return;
  if (!admin) {
    console.log(`[Push:SIMULIERT] -> Token ${String(pushToken).slice(0, 14)}... | "${title}": ${body}`);
    return;
  }
  try {
    await admin.messaging().send({
      token: pushToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
    });
  } catch (e) {
    console.log('[Push] Fehler beim Senden an Token:', e.message);
  }
}

// Schickt eine Push-Nachricht an eine Liste von Spieler-Objekten (nur an die,
// die einen registrierten pushToken haben - andere werden einfach übersprungen).
function notifyPlayers(players, title, body, data = {}) {
  (players || []).forEach(p => {
    if (p && p.pushToken) {
      sendToToken(p.pushToken, title, body, data).catch(() => {});
    }
  });
}

module.exports = { sendToToken, notifyPlayers };
