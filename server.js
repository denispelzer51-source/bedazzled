const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const push = require('./push');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Eigener, direkter Link für die "echte" 3D-Spielversion (mit Animationen), separat vom
// normalen 2D-Spiel unter "/" und vom Mehrfenster-Testsimulator unter "/simulator-3d.html".
// Damit können echte Mitspieler:innen ganz normal miteinander spielen, nur eben mit dem
// 3D-Brett statt der 2D-Ansicht - technisch ist das dieselbe index-3d.html, die der
// Testsimulator ohnehin schon mehrfach als iframe einbettet, hier aber als eigenständige,
// normal aufrufbare Seite (kein "testSlot"-Parameter, also auch keine Test-Komfortfunktionen
// wie automatisch vorausgefüllte Namen/Spielfiguren).
app.get('/3d', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index-3d.html'));
});

const QUESTIONS_PATH = path.join(__dirname, 'questions.json');
const ESTIMATE_QUESTIONS_PATH = path.join(__dirname, 'estimate_questions.json');

// ---------- Fragen-Speicherung: MongoDB Atlas, falls eingerichtet - sonst lokale Dateien ----------
// Sobald die Umgebungsvariable MONGODB_URI auf Render gesetzt ist, werden Fragen dauerhaft
// in der Datenbank gespeichert (überlebt Deploys). Ist sie nicht gesetzt, läuft alles wie
// bisher über die lokalen JSON-Dateien weiter - kein Bruch, falls die DB noch nicht bereit ist.
const MONGODB_URI = process.env.MONGODB_URI || '';
const useMongo = !!MONGODB_URI;
let mongoDb = null;

let questionsList = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));
let estimateQuestionsList = JSON.parse(fs.readFileSync(ESTIMATE_QUESTIONS_PATH, 'utf8'));

// Migration: bereits vorhandene Fragen (aus der Datei, vor Einführung des "reviewed"-
// Flags) gelten als geprüft, damit sie nicht plötzlich aus dem laufenden Spiel
// verschwinden. Nur wirklich NEUE Fragen (per Formular/Import) starten als ungeprüft.
function migrateReviewedFlag(list) {
  let changed = false;
  list.forEach(q => {
    if (q.reviewed === undefined) { q.reviewed = true; changed = true; }
  });
  return changed;
}
if (migrateReviewedFlag(questionsList)) fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(questionsList, null, 2), 'utf8');
if (migrateReviewedFlag(estimateQuestionsList)) fs.writeFileSync(ESTIMATE_QUESTIONS_PATH, JSON.stringify(estimateQuestionsList, null, 2), 'utf8');

// Migration: die Fragenverwaltung kennt ab sofort nur noch genau VIER Kategorien fuer
// Bluff-Fragen: "Normale Fragen", "Fremdwörter", "Zeichnen" (Schätzfragen leben weiterhin
// in einer eigenen Liste/Collection, siehe estimateQuestionsList). Aeltere Kategorien wie
// "Kuriositäten" oder "Historischer Kontext" werden hier automatisch nach "Normale Fragen"
// zusammengefuehrt. Da diese Umsortierung fehleranfaellig sein kann (die Zuordnung war
// vorher durcheinander), werden umsortierte Fragen bewusst wieder als "ungeprüft"
// markiert, damit sie in /admin.html manuell nochmal kontrolliert werden, BEVOR sie
// weiter im Spiel auftauchen wuerden - sie bleiben aber sofort im Spiel nutzbar, da schon
// vorher vorhandene Fragen laut Migration oben ohnehin als reviewed=true gelten; das
// "erneut pruefen"-Signal ist hier also nur die reviewed=false-Markierung, kein Rauswurf.
const VALID_BLUFF_CATEGORIES = new Set(['Normale Fragen', 'Fremdwörter', 'Zeichnen']);
const LEGACY_CATEGORY_MAP = {
  'Kuriositäten': 'Normale Fragen',
  'Historischer Kontext': 'Normale Fragen',
  'Sonstige': 'Normale Fragen',
};
function migrateCategoriesToFour(list) {
  let changed = false;
  list.forEach(q => {
    const original = q.category;
    if (!VALID_BLUFF_CATEGORIES.has(original)) {
      const mapped = LEGACY_CATEGORY_MAP[original] || 'Normale Fragen';
      q.category = mapped;
      q.reviewed = false; // muss nach der Umsortierung nochmal manuell geprüft werden
      changed = true;
    }
  });
  return changed;
}
if (migrateCategoriesToFour(questionsList)) fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(questionsList, null, 2), 'utf8');

async function initDatabase() {
  if (!useMongo) {
    console.log('[DB] Keine MONGODB_URI gesetzt - Fragen laufen über lokale JSON-Dateien.');
    return;
  }
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    mongoDb = client.db('bedazzled');
    console.log('[DB] Mit MongoDB Atlas verbunden.');

    const questionsCol = mongoDb.collection('questions');
    const estimateCol = mongoDb.collection('estimateQuestions');

    const existingQuestions = await questionsCol.countDocuments();
    if (existingQuestions === 0) {
      console.log('[DB] Erstbefüllung: bestehende Bluff-Fragen aus questions.json werden importiert …');
      if (questionsList.length > 0) await questionsCol.insertMany(questionsList.map(stripId));
    }
    const existingEstimate = await estimateCol.countDocuments();
    if (existingEstimate === 0) {
      console.log('[DB] Erstbefüllung: bestehende Schätzen-Fragen aus estimate_questions.json werden importiert …');
      if (estimateQuestionsList.length > 0) await estimateCol.insertMany(estimateQuestionsList.map(stripId));
    }

    questionsList = (await questionsCol.find().toArray()).map(stripId);
    estimateQuestionsList = (await estimateCol.find().toArray()).map(stripId);
    console.log(`[DB] Geladen: ${questionsList.length} Bluff-Fragen, ${estimateQuestionsList.length} Schätzen-Fragen aus MongoDB.`);

    // Migration: bestehende Fragen in der DB (von vor Einführung des "reviewed"-Flags)
    // gelten als bereits geprüft, damit sie im laufenden Spiel bleiben
    if (migrateReviewedFlag(questionsList)) {
      await questionsCol.deleteMany({});
      await questionsCol.insertMany(questionsList.map(stripId));
    }
    if (migrateReviewedFlag(estimateQuestionsList)) {
      await estimateCol.deleteMany({});
      await estimateCol.insertMany(estimateQuestionsList.map(stripId));
    }

    // Kategorien-Migration (siehe migrateCategoriesToFour oben) muss auch auf die aus
    // MongoDB geladenen Fragen angewendet werden, da das eigentliche Live-Spiel auf Render
    // über MONGODB_URI läuft und NICHT über die lokalen JSON-Dateien.
    if (migrateCategoriesToFour(questionsList)) {
      await questionsCol.deleteMany({});
      await questionsCol.insertMany(questionsList.map(stripId));
    }

    // EINMALIGER Reset (nur beim allerersten Start nach diesem Update): ALLE Fragen -
    // Bluff wie Schätzen, unabhängig davon, ob ihre Kategorie durch die obige Migration
    // überhaupt verändert wurde - werden auf "ungeprüft" zurückgesetzt. Grund: die
    // Kategorien-Zuordnung war insgesamt durcheinander, nicht nur bei den offensichtlich
    // umbenannten Kategorien, daher müssen wirklich alle Fragen nochmal manuell in
    // /admin.html durchgesehen werden. Ein Marker-Dokument sorgt dafür, dass das nur EINMAL
    // passiert und nicht bei jedem künftigen Deploy die inzwischen schon wieder geprüften
    // Fragen erneut zurücksetzt.
    const metaCol = mongoDb.collection('meta');
    const resetMarker = await metaCol.findOne({ _id: 'reviewedResetV1' });
    if (!resetMarker) {
      console.log('[DB] Einmaliger Reset: alle Fragen werden wegen der Kategorie-Neusortierung auf "ungeprüft" gesetzt …');
      questionsList.forEach(q => { q.reviewed = false; });
      estimateQuestionsList.forEach(q => { q.reviewed = false; });
      await questionsCol.deleteMany({});
      await questionsCol.insertMany(questionsList.map(stripId));
      await estimateCol.deleteMany({});
      await estimateCol.insertMany(estimateQuestionsList.map(stripId));
      await metaCol.insertOne({ _id: 'reviewedResetV1', appliedAt: new Date() });
    }
  } catch (err) {
    console.error('[DB] Verbindung zu MongoDB fehlgeschlagen, falle auf lokale Dateien zurück:', err.message);
    mongoDb = null;
  }
}

function stripId(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

const BOARD_LENGTH = 28; // jetzt an das 3D-Testbrett angeglichen (das schon länger den Wert 28 nutzt, siehe board28 unten)
// Der board28-Sonderfall unten ist dadurch inzwischen ein reines No-Op (28 === 28) - bleibt
// aber bewusst als Parameter bestehen, falls das 3D-Brett zukünftig doch mal einen anderen
// Wert als die normalen Räume brauchen sollte.
function scaleTriggerFields(fields, boardLength) {
  return fields.map(f => Math.round((f * boardLength) / BOARD_LENGTH));
}
const POINTS_CORRECT_GUESS = 3;
const POINTS_PER_FOOLED_PLAYER = 2;
const DISCONNECT_GRACE_MS = 3 * 60 * 1000; // 3 Minuten, bevor ein getrennter Spieler endgültig entfernt wird

// Felder, die eine Schätzen-Karte statt der normalen Bluff-Frage auslösen (bewusst unregelmäßig verteilt)
const ESTIMATE_TRIGGER_FIELDS = [5, 8, 13, 18];
// Schätzen-Punkte: Platz 1 UND Platz 2 bekommen jeweils 2 Punkte (nicht mehr 3/2), Platz 3
// bekommt 1 Punkt. Damit ist automatisch sichergestellt, dass zwei Spieler:innen, die
// zufällig exakt denselben Wert (und damit dieselbe Abweichung) abgeben, auch garantiert
// dieselbe Punktzahl bekommen (siehe Tie-Handling in der revealEstimate-Auswertung unten).
const ESTIMATE_POINTS = [2, 2, 1]; // Platz 1, 2, 3 – Rest geht leer aus

// Blaue Felder: Fremdwörter-Fragen (etwas seltener als die lila Standardfelder)
const FOREIGNWORD_TRIGGER_FIELDS = [2, 10, 16, 22];
// Gelbe Felder: Zeichnenrunde (Moderator zeichnet einen Begriff, andere raten mit)
const DRAWING_TRIGGER_FIELDS = [4, 12, 19, 24];
const DRAWING_GUESS_POINTS = [3, 2]; // 1. und 2. richtig Ratende:r - danach endet die Runde automatisch

// Aufholjagd: sobald irgendjemand dieses Feld erreicht/überschreitet, bekommt der/die
// Letztplatzierte einmalig einen Bonus, damit das Spiel spannend bleibt
const CATCHUP_TRIGGER_FIELD = 18;
const CATCHUP_BONUS = 5;

// Zugangscode für die Fragen-Verwaltung (/admin.html). Auf Render als Umgebungsvariable
// ADMIN_KEY setzen, um den Standardwert zu überschreiben.
const ADMIN_KEY = process.env.ADMIN_KEY || 'bedazzled-admin';
// Separater Code fürs In-Game-Admin-Tool (Runde überspringen, jeden Spieler kicken) -
// unabhängig vom Fragen-Admin-Panel-Key oben. Unbedingt per Env-Var GAME_ADMIN_CODE
// auf Render überschreiben, bevor andere Leute mitspielen!
const GAME_ADMIN_CODE = process.env.GAME_ADMIN_CODE || 'bedazzled-superadmin';

function checkAdmin(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    res.status(401).json({ error: 'Falscher Zugangscode.' });
    return;
  }
  next();
}

function saveQuestions() {
  // Lokale Datei bleibt immer als Backup bestehen (überlebt aber keinen Deploy)
  fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(questionsList, null, 2), 'utf8');
  if (mongoDb) {
    const col = mongoDb.collection('questions');
    col.deleteMany({})
      .then(() => (questionsList.length > 0 ? col.insertMany(questionsList.map(stripId)) : null))
      .catch(err => console.error('[DB] Fehler beim Speichern der Bluff-Fragen:', err.message));
  }
}

function saveEstimateQuestions() {
  fs.writeFileSync(ESTIMATE_QUESTIONS_PATH, JSON.stringify(estimateQuestionsList, null, 2), 'utf8');
  if (mongoDb) {
    const col = mongoDb.collection('estimateQuestions');
    col.deleteMany({})
      .then(() => (estimateQuestionsList.length > 0 ? col.insertMany(estimateQuestionsList.map(stripId)) : null))
      .catch(err => console.error('[DB] Fehler beim Speichern der Schätzen-Fragen:', err.message));
  }
}

// ---------- Fragen-Verwaltung: Schätzen-Karten (Admin-API) ----------
app.get('/api/estimate-questions', checkAdmin, (req, res) => {
  res.json(estimateQuestionsList);
});

app.post('/api/estimate-questions', checkAdmin, (req, res) => {
  const { question, answer, category, topic } = req.body || {};
  const numericAnswer = Number(answer);
  if (!question || Number.isNaN(numericAnswer)) {
    res.status(400).json({ error: 'Frage und eine numerische Antwort sind erforderlich.' });
    return;
  }
  estimateQuestionsList.push({
    category: (category || 'Sonstige').trim(),
    topic: (topic || 'Sonstiges').trim(),
    question: question.trim(),
    answer: numericAnswer,
    reviewed: false,
  });
  saveEstimateQuestions();
  res.json(estimateQuestionsList);
});

app.put('/api/estimate-questions/:index', checkAdmin, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (!estimateQuestionsList[idx]) {
    res.status(404).json({ error: 'Frage nicht gefunden.' });
    return;
  }
  const { question, answer, category, topic } = req.body || {};
  if (question) estimateQuestionsList[idx].question = question.trim();
  if (answer !== undefined && !Number.isNaN(Number(answer))) estimateQuestionsList[idx].answer = Number(answer);
  if (category) estimateQuestionsList[idx].category = category.trim();
  if (topic) estimateQuestionsList[idx].topic = topic.trim();
  estimateQuestionsList[idx].reviewed = true;
  saveEstimateQuestions();
  res.json(estimateQuestionsList);
});

app.put('/api/estimate-questions/:index/reviewed', checkAdmin, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (!estimateQuestionsList[idx]) {
    res.status(404).json({ error: 'Frage nicht gefunden.' });
    return;
  }
  const { reviewed } = req.body || {};
  estimateQuestionsList[idx].reviewed = !!reviewed;
  saveEstimateQuestions();
  res.json(estimateQuestionsList);
});

app.delete('/api/estimate-questions/:index', checkAdmin, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (!estimateQuestionsList[idx]) {
    res.status(404).json({ error: 'Frage nicht gefunden.' });
    return;
  }
  estimateQuestionsList.splice(idx, 1);
  saveEstimateQuestions();
  res.json(estimateQuestionsList);
});

app.post('/api/estimate-questions/import', checkAdmin, (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'Erwartet ein Array von Fragen.' });
    return;
  }
  const valid = items
    .filter(i => i && i.question && !Number.isNaN(Number(i.answer)))
    .map(i => ({
      category: (i.category || 'Sonstige').toString().trim(),
      topic: (i.topic || 'Sonstiges').toString().trim(),
      question: String(i.question).trim(),
      answer: Number(i.answer),
      reviewed: false,
    }));
  if (valid.length === 0) {
    res.status(400).json({ error: 'Keine gültigen Fragen im Import gefunden.' });
    return;
  }
  estimateQuestionsList.push(...valid);
  saveEstimateQuestions();
  res.json(estimateQuestionsList);
});

// ---------- Fragen-Verwaltung: Bluff-Fragen (Admin-API) ----------
app.get('/api/storage-status', checkAdmin, (req, res) => {
  res.json({ usingMongo: !!mongoDb });
});

app.get('/api/questions', checkAdmin, (req, res) => {
  res.json(questionsList);
});

app.post('/api/questions', checkAdmin, (req, res) => {
  const { question, answer, category, topic } = req.body || {};
  if (!question || !answer) {
    res.status(400).json({ error: 'Frage und Antwort sind erforderlich.' });
    return;
  }
  questionsList.push({
    category: (category || 'Sonstige').trim(),
    topic: (topic || 'Sonstiges').trim(),
    question: question.trim(),
    answer: answer.trim(),
    reviewed: false, // neu erstellte Fragen müssen erst geprüft werden, bevor sie im Spiel landen
  });
  saveQuestions();
  res.json(questionsList);
});

app.put('/api/questions/:index', checkAdmin, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (!questionsList[idx]) {
    res.status(404).json({ error: 'Frage nicht gefunden.' });
    return;
  }
  const { question, answer, category, topic } = req.body || {};
  if (question) questionsList[idx].question = question.trim();
  if (answer) questionsList[idx].answer = answer.trim();
  if (category) questionsList[idx].category = category.trim();
  if (topic) questionsList[idx].topic = topic.trim();
  // Manuelles Bearbeiten zählt als Prüfung - die Frage darf ab jetzt im Spiel vorkommen
  questionsList[idx].reviewed = true;
  saveQuestions();
  res.json(questionsList);
});

app.put('/api/questions/:index/reviewed', checkAdmin, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (!questionsList[idx]) {
    res.status(404).json({ error: 'Frage nicht gefunden.' });
    return;
  }
  const { reviewed } = req.body || {};
  questionsList[idx].reviewed = !!reviewed;
  saveQuestions();
  res.json(questionsList);
});

app.delete('/api/questions/:index', checkAdmin, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (!questionsList[idx]) {
    res.status(404).json({ error: 'Frage nicht gefunden.' });
    return;
  }
  questionsList.splice(idx, 1);
  saveQuestions();
  res.json(questionsList);
});

app.post('/api/questions/import', checkAdmin, (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'Erwartet ein Array von Fragen.' });
    return;
  }
  const valid = items
    .filter(i => i && i.question && i.answer)
    .map(i => ({
      category: (i.category || 'Sonstige').toString().trim(),
      topic: (i.topic || 'Sonstiges').toString().trim(),
      question: String(i.question).trim(),
      answer: String(i.answer).trim(),
      reviewed: false, // importierte Fragen müssen erst geprüft werden
    }));
  if (valid.length === 0) {
    res.status(400).json({ error: 'Keine gültigen Fragen im Import gefunden.' });
    return;
  }
  questionsList.push(...valid);
  saveQuestions();
  res.json(questionsList);
});

/** rooms: { code: { players: [{id (=Token, stabil ueber Reconnects), name, avatar, position, socketId}],
 *   moderatorIndex, phase, usedQuestions:[], answers: {playerId: text}, votes: {playerId: chosenAnswerOwnerId},
 *   shuffledAnswers: [{ownerId, text, isReal}], removalTimers: {playerId: TimeoutHandle} } }
 */
const rooms = {};

const AVATAR_SET = ['💎', '🎭', '🔮', '🃏', '👑', '⭐'];

// Prüft/korrigiert eingereichte Antworten automatisch (Rechtschreibung & Grammatik),
// damit Tippfehler nicht verraten, welche Antwort erfunden ist. Nutzt die kostenlose
// LanguageTool-API. Bei Fehlern/Timeout wird einfach der Originaltext verwendet,
// damit das Spiel nie wegen eines API-Problems blockiert.
// ---------- Ähnlichkeits-Prüfung, um zu verhindern, dass eine erfundene Antwort
// (fast) wortgleich mit der echten Antwort ist ----------
function normalizeForCompare(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // Akzente entfernen, Umlaute bleiben
    .replace(/[^\wäöüß\s]/g, '') // Satzzeichen entfernen
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function isTooSimilarToRealAnswer(candidate, realAnswer) {
  const a = normalizeForCompare(candidate);
  const b = normalizeForCompare(realAnswer);
  if (!a || !b) return false;

  // Metrik 1: Zeichen-Ähnlichkeit (fängt Tippfehler-Varianten & fast identischen Wortlaut ab)
  const maxLen = Math.max(a.length, b.length);
  const charSimilarity = 1 - levenshtein(a, b) / maxLen;

  // Metrik 2: Wort-Überlappung relativ zur kürzeren Antwort (fängt auch den Fall ab,
  // dass jemand nur den Kernbegriff aus einer längeren echten Antwort abschreibt)
  const stopwords = new Set(['der', 'die', 'das', 'ein', 'eine', 'und', 'oder', 'ist', 'sind', 'von', 'zu', 'im', 'in', 'den', 'dem']);
  const wordsA = new Set(a.split(' ').filter(w => w.length > 2 && !stopwords.has(w)));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2 && !stopwords.has(w)));
  let overlap = 0;
  wordsA.forEach(w => { if (wordsB.has(w)) overlap++; });
  const smallerSize = Math.min(wordsA.size, wordsB.size);
  const wordSimilarity = smallerSize > 0 ? overlap / smallerSize : 0;

  return charSimilarity > 0.82 || wordSimilarity > 0.7;
}

function getTakenAvatars(room) {
  return room.players.map(p => p.avatar).filter(Boolean);
}

function genRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

function publicRoomState(room, forPlayerId) {
  const moderatorId = room.players[room.moderatorIndex] ? room.players[room.moderatorIndex].id : null;
  const isModerator = forPlayerId === moderatorId;
  return {
    code: room.code,
    phase: room.phase,
    isMultiplayerMatch: !!room.isMultiplayerMatch,
    gameOver: room.gameOverInfo || null,
    adminForcedFromPositions: (room.phase === 'board' && room.adminForcedFromPositions) ? room.adminForcedFromPositions : null,
    roundType: room.roundType || 'question',
    pendingRoundType: room.pendingRoundType || 'question',
    cardDrawn: !!room.cardDrawn,
    boardLength: room.boardLength || BOARD_LENGTH,
    estimateTriggerFields: room.estimateTriggerFields || ESTIMATE_TRIGGER_FIELDS,
    foreignwordTriggerFields: room.foreignwordTriggerFields || FOREIGNWORD_TRIGGER_FIELDS,
    drawingTriggerFields: room.drawingTriggerFields || DRAWING_TRIGGER_FIELDS,
    pointsCorrectGuess: POINTS_CORRECT_GUESS,
    pointsPerFooled: POINTS_PER_FOOLED_PLAYER,
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, position: p.position, connected: !!p.socketId })),
    moderatorId,
    hostId: room.hostId,
    currentQuestion: (room.phase !== 'lobby' && room.currentQuestionObj && (room.phase !== 'drawing' || isModerator))
      ? room.currentQuestionObj.question
      : null,
    realAnswer: (isModerator && room.phase === 'answering' && room.currentQuestionObj) ? room.currentQuestionObj.answer : null,
    answeredCount: Object.keys(room.answers || {}).length,
    votedCount: Object.keys(room.votes || {}).length,
    // Der/die Moderator:in sieht schon während der Antwort-Phase live, wer was schreibt
    // (auch bevor abgeschickt wurde), inkl. Kennzeichnung ob final abgeschickt.
    answersPreview: (isModerator && room.phase === 'answering')
      ? room.players
          .filter(p => p.id !== moderatorId)
          .map(p => {
            const submitted = room.answers[p.id] !== undefined;
            const text = submitted ? room.answers[p.id] : ((room.liveTyping && room.liveTyping[p.id]) || '');
            return { id: p.id, name: p.name, text, submitted };
          })
      : [],
    // Nur für die Moderation: Fälle, in denen eine eingereichte Antwort praktisch identisch
    // mit der echten Antwort ist und manuell aufgelöst werden muss, bevor es weitergeht
    // Fragen-Vorschau: nur der/die Moderator:in sieht die Kandidaten und Details,
    // andere Spieler bekommen nur die reine Phasen-Info (Warte-Screen)
    questionPreview: (isModerator && room.phase === 'previewQuestion')
      ? {
          candidates: (room.questionCandidates || []).map(c => ({
            question: c.question, category: c.category, topic: c.topic,
          })),
          currentIndex: room.previewIndex || 0,
          canSwapMore: room.unlimitedQuestionSwaps || (room.questionCandidates || []).length < 3,
          roundType: room.roundType,
        }
      : null,
    unlimitedQuestionSwaps: !!room.unlimitedQuestionSwaps,
    gameStarted: !!room.gameStarted,
    answerTimeLimitSet: !!room.answerTimeLimitSet,
    answerTimeLimit: room.answerTimeLimit || null,
    answerDeadline: room.phase === 'answering' ? (room.answerDeadline || null) : null,
    answerTimeExpired: !!room.answerTimeExpired,
    duplicateConflicts: (isModerator && room.phase === 'answering')
      ? (room.duplicateConflicts || []).map(pid => {
          const p = room.players.find(pp => pp.id === pid);
          return { playerId: pid, name: p ? p.name : '???', answerText: room.answers[pid] };
        })
      : [],
    // Damit jede:r sofort sieht, ob die eigene Wahl in der Abstimmung richtig war
    myVote: room.votes[forPlayerId] || null,
    // Damit ein Reload/Reconnect während der Antwort-Phase den eigenen Abgabestatus
    // korrekt wiederherstellt, statt das Eingabefeld fälschlich leer zurückzusetzen
    myAnswerSubmitted: room.answers[forPlayerId] !== undefined,
    myAnswerText: room.answers[forPlayerId] !== undefined ? room.answers[forPlayerId] : null,
    // Die eigene Antwort war bisher während der Abstimmung komplett aus der Liste
    // rausgefiltert (man konnte ja eh nicht sinnvoll für sich selbst stimmen). Jetzt wird
    // sie stattdessen WEITERHIN mit angezeigt (isMine:true), aber im Client nicht anklickbar
    // gemacht - man soll seine eigene Antwort zwischen den anderen wiederfinden können,
    // ohne sie aus Versehen anwählen zu können.
    shuffledAnswers: room.phase === 'voting'
      ? room.shuffledAnswers.map(a => ({ text: a.text, ownerId: a.ownerId, isMine: a.ownerId === forPlayerId }))
      : (room.phase === 'reveal' ? room.shuffledAnswers : []),
    // Moderator:in sieht schon während der Abstimm-Phase, welche Antwort gerade angetippt wurde
    votePreview: (isModerator && room.phase === 'voting')
      ? room.players
          .filter(p => p.id !== moderatorId)
          .map(p => ({
            name: p.name,
            chosenOwnerId: (room.votePreview && room.votePreview[p.id]) || null,
            submitted: room.votes[p.id] !== undefined,
          }))
      : [],
    // Ranking-Ergebnis für Schätzen-Runden (nur in der Auflösung relevant)
    estimateResults: room.phase === 'reveal' ? (room.estimateResults || []) : [],
    estimateRealAnswer: (room.phase === 'reveal' && room.roundType === 'estimate' && room.currentQuestionObj)
      ? room.currentQuestionObj.answer
      : null,
    // Zeichnenrunde: Moderator sieht, wer schon richtig geraten hat; Mitspieler sehen
    // nur ihren eigenen Status (nicht die anderen, um kein Rennen/Gruppenzwang zu erzeugen)
    drawingCorrectGuessers: (isModerator && room.phase === 'drawing')
      ? (room.correctGuessers || []).map(id => (room.players.find(p => p.id === id) || {}).name || '???')
      : [],
    myGuessCorrect: room.phase === 'drawing' ? (room.correctGuessers || []).includes(forPlayerId) : false,
    drawingRoundId: room.drawingRoundId || 0,
    drawingStartedAt: room.phase === 'drawing' ? (room.drawingStartedAt || null) : null,
    drawingPresence: (room.phase === 'drawingPresence')
      ? (() => {
          const moderatorId = room.players[room.moderatorIndex].id;
          const guessers = room.players.filter(p => p.id !== moderatorId);
          const confirmedIds = guessers.filter(p => room.presenceConfirmed && room.presenceConfirmed[p.id]).map(p => p.id);
          return {
            total: guessers.length,
            confirmedCount: confirmedIds.length,
            confirmedNames: confirmedIds.map(id => room.players.find(p => p.id === id)?.name).filter(Boolean),
            iHaveConfirmed: !!(room.presenceConfirmed && room.presenceConfirmed[forPlayerId]),
          };
        })()
      : null,
    drawingResult: (room.phase === 'reveal' && room.drawingResult) ? room.drawingResult : null,
    catchUpAnnouncement: room.catchUpAnnouncement || null,
  };
}

// ---- Antwort-Timer (Host-Einstellung: 60s / 120s / kein Limit) ----
// Läuft serverseitig, damit alle Spieler denselben Countdown sehen (unabhängig von der
// jeweiligen Client-Uhr) und der Moderator nach Ablauf auch dann weiterkommt, wenn
// noch nicht alle geantwortet haben.
function clearAnswerTimer(room) {
  if (room.answerTimerId) {
    clearTimeout(room.answerTimerId);
    room.answerTimerId = null;
  }
}
function startAnswerTimerIfNeeded(room, code) {
  clearAnswerTimer(room);
  room.answerTimeExpired = false;
  if (room.answerTimeLimit) {
    room.answerDeadline = Date.now() + room.answerTimeLimit * 1000;
    room.answerTimerId = setTimeout(() => {
      const r = rooms[code];
      if (!r || r.phase !== 'answering') return; // Runde hat sich in der Zwischenzeit geändert - nichts tun
      r.answerTimeExpired = true;
      r.answerTimerId = null;
      broadcastState(code);
      console.log(`[Antwort-Timer] Zeit abgelaufen in Raum ${code}.`);
    }, room.answerTimeLimit * 1000);
  } else {
    room.answerDeadline = null;
  }
}

function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.players.forEach(p => {
    if (p.socketId) io.to(p.socketId).emit('state', publicRoomState(room, p.id));
  });
}

function pickNextQuestion(room, roundType, excludeIndices = []) {
  let pool, usedKey;
  if (roundType === 'estimate') {
    // Schätzfragen leben in einer eigenen Liste/Collection - trotzdem zusätzlich defensiv
    // auf die Kategorie prüfen, falls dort doch mal ein falsch einsortierter Eintrag landet.
    pool = estimateQuestionsList.filter(q => q.category === 'Schätzfragen' && q.reviewed === true);
  } else if (roundType === 'foreignword') {
    // Blaue Felder: nur Fremdwörter-Fragen
    pool = questionsList.filter(q => q.category === 'Fremdwörter' && q.reviewed === true);
  } else if (roundType === 'drawing') {
    // Gelbe Felder: Begriffe aus der Kategorie "Zeichnen" (übers Fragen-Verwaltung-Panel
    // gepflegt wie alle anderen Fragen auch - "Frage"-Feld enthält den Begriff)
    pool = questionsList.filter(q => q.category === 'Zeichnen' && q.reviewed === true);
  } else {
    // Lila Standardfelder: NUR die Kategorie "Normale Fragen" - bewusst als expliziter
    // Einschluss (statt "alles außer Fremdwörter/Zeichnen") formuliert, damit hier niemals
    // versehentlich eine falsch/gar nicht kategorisierte Frage (z.B. durch einen Import-
    // oder Migrations-Fehler) landet, die eigentlich in keine der vier echten Kategorien
    // gehört.
    pool = questionsList.filter(q => q.category === 'Normale Fragen' && q.reviewed === true);
  }
  usedKey = roundType === 'estimate' ? 'usedEstimateQuestions'
    : roundType === 'foreignword' ? 'usedForeignwordQuestions'
    : roundType === 'drawing' ? 'usedDrawTerms'
    : 'usedQuestions';
  if (pool.length === 0) {
    // Notfall: NIE in eine andere Kategorie ausweichen (eine Zeichnenrunde darf niemals
    // eine Fremdwort-/Bluff-Frage zeigen und umgekehrt) - höchstens das reviewed-Flag
    // ignorieren, falls in der richtigen Kategorie nur ungeprüfte Einträge existieren.
    if (roundType === 'estimate') {
      pool = estimateQuestionsList.filter(q => q.category === 'Schätzfragen');
    } else if (roundType === 'foreignword') {
      pool = questionsList.filter(q => q.category === 'Fremdwörter');
    } else if (roundType === 'drawing') {
      pool = questionsList.filter(q => q.category === 'Zeichnen');
    } else {
      pool = questionsList.filter(q => q.category === 'Normale Fragen');
    }
  }
  if (pool.length === 0) return null; // Kategorie ist wirklich komplett leer - Aufrufer muss das behandeln

  if (!room[usedKey]) room[usedKey] = [];
  const usedOrExcluded = new Set([...room[usedKey], ...excludeIndices]);
  let available = pool.map((q, i) => i).filter(i => !usedOrExcluded.has(i));
  if (available.length === 0) {
    // Alle Fragen im Pool schon verwendet - Pool "auffrischen", aber innerhalb dieser
    // Vorschau trotzdem keine der gerade schon gezeigten Kandidaten wiederholen
    available = pool.map((q, i) => i).filter(i => !excludeIndices.includes(i));
    if (available.length === 0) available = pool.map((q, i) => i); // absoluter Notfall (Pool winzig)
  }
  const idx = available[Math.floor(Math.random() * available.length)];
  const picked = pool[idx];

  if (roundType === 'drawing') {
    // Gleiche Form wie eine normale Frage, damit die Fragen-Vorschau unverändert
    // wiederverwendet werden kann - "question" ist der Anzeige-Text für den/die
    // Moderator:in, "answer" ist der eigentliche zu erratende Begriff.
    return { index: idx, question: `Zeichne: ${picked.question}`, answer: picked.answer, category: '🎨 Zeichnenrunde', topic: picked.topic || '' };
  }
  return { index: idx, ...picked };
}

// Prüft, ob jemand durch die Punktevergabe DIESER Runde neu auf einem Schätzen-Feld
// gelandet ist (nicht: ob er zufällig schon länger dort steht). Nur ein frischer Zug auf
// eines der Felder löst die nächste Runde als Schätzen-Karte aus.
// Aufholjagd: einmalig pro Spiel, sobald jemand das Trigger-Feld erreicht/überschreitet,
// bekommt der/die Letztplatzierte (bei Gleichstand: alle Letzten) einen Bonus-Vorstoß
// AUSGESCHALTET (auf Wunsch entfernt) - Funktion bleibt hier stehen, falls der
// Aufhol-Bonus irgendwann wieder gebraucht wird, wird aber aktuell nirgends mehr aufgerufen.
function applyCatchUpBonus(room) {
  return;
}

function applyRoundTypeTriggerCheck(room, prevPositions) {
  const movedOnto = (fields) => room.players.some(p => fields.includes(p.position) && p.position !== prevPositions[p.id]);
  const estimateFields = room.estimateTriggerFields || ESTIMATE_TRIGGER_FIELDS;
  const drawingFields = room.drawingTriggerFields || DRAWING_TRIGGER_FIELDS;
  const foreignwordFields = room.foreignwordTriggerFields || FOREIGNWORD_TRIGGER_FIELDS;
  if (movedOnto(estimateFields)) room.pendingRoundType = 'estimate';
  else if (movedOnto(drawingFields)) room.pendingRoundType = 'drawing';
  else if (movedOnto(foreignwordFields)) room.pendingRoundType = 'foreignword';
  else room.pendingRoundType = 'question';
}

function ensureStats(room, playerId) {
  if (!room.stats) room.stats = {};
  if (!room.stats[playerId]) room.stats[playerId] = { fooled: 0, timesFooled: 0, estimateBest: 0 };
  return room.stats[playerId];
}

function computeAwards(room) {
  const awards = [];
  const entries = Object.entries(room.stats || {});
  const nameFor = id => { const p = room.players.find(pp => pp.id === id); return p ? p.name : null; };
  const mentionedIds = new Set();

  function topAward(key, title, emoji) {
    const max = Math.max(0, ...entries.map(([, s]) => s[key]));
    if (max === 0) return;
    const winnerIds = entries.filter(([, s]) => s[key] === max).map(([id]) => id);
    const names = winnerIds.map(nameFor).filter(Boolean);
    if (names.length > 0) {
      awards.push({ title: `${emoji} ${title}`, names, count: max });
      winnerIds.forEach(id => mentionedIds.add(id));
    }
  }

  topAward('fooled', 'Bester Bluffer', '🎭');
  topAward('timesFooled', 'Meist Getäuscht', '🙈');
  topAward('estimateBest', 'Schätz-Ass', '🎯');

  // WICHTIG: jede:r Spieler:in muss irgendwo auftauchen, auch wenn er/sie in keiner der
  // Kategorien vorne lag - sonst fehlen manche Spieler:innen komplett im Abschluss-Popup.
  const remaining = room.players.filter(p => !mentionedIds.has(p.id));
  if (remaining.length > 0) {
    const names = remaining.map(p => {
      const s = (room.stats && room.stats[p.id]) || { fooled: 0, timesFooled: 0, estimateBest: 0 };
      return `${p.name} (${s.fooled}× geblufft, ${s.timesFooled}× reingefallen)`;
    });
    awards.push({ title: '🎉 Ebenfalls mit dabei', names, count: null });
  }
  return awards;
}

function checkForWinner(code, room) {
  const finishers = room.players.filter(p => p.position >= (room.boardLength || BOARD_LENGTH));
  if (finishers.length === 0) return;
  // Bei mehreren Spielern, die in derselben Runde ins Ziel laufen, gewinnt wer am
  // weitesten gekommen ist (mehr Felder gemacht hat), nicht wer zufällig zuerst geprüft wurde.
  const winner = finishers.reduce((best, p) => (p.position > best.position ? p : best), finishers[0]);
  room.gameOverInfo = { winnerName: winner.name, awards: computeAwards(room) };
  // Die eigentliche Bekanntgabe (Pop-up) erfolgt erst, wenn das Spielbrett gezeigt wurde
  // (siehe 'showBoard'), damit man noch sieht, wie die Figur ins Ziel läuft.
}

function removePlayerForGood(roomCode, playerId) {
  const room = rooms[roomCode];
  if (!room) return;
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx === -1) return;
  room.players.splice(idx, 1);
  if (room.players.length === 0) {
    delete rooms[roomCode];
    return;
  }
  if (room.moderatorIndex >= room.players.length) room.moderatorIndex = 0;
  if (room.hostId === playerId) room.hostId = room.players[0].id; // Host-Rolle wandert weiter

  // Falls jemand mitten im Anwesenheits-Check einer Zeichnenrunde geht: prüfen, ob die
  // verbleibenden Mitspieler:innen jetzt vollständig bestätigt haben, statt für immer zu warten.
  if (room.phase === 'drawingPresence') {
    const moderatorId = room.players[room.moderatorIndex].id;
    const guessers = room.players.filter(p => p.id !== moderatorId);
    const allConfirmed = guessers.length > 0 && guessers.every(p => room.presenceConfirmed && room.presenceConfirmed[p.id]);
    if (allConfirmed) {
      room.phase = 'drawing';
      room.drawingStartedAt = Date.now();
      room.correctGuessers = [];
      room.guesses = {};
      room.drawingStartPositions = {};
      room.players.forEach(p => { room.drawingStartPositions[p.id] = p.position; });
      push.notifyPlayers([room.players[room.moderatorIndex]], 'Du bist dran! 🎨', 'Zeichne den Begriff.', { code: roomCode, type: 'drawing-mod' });
    }
  }

  broadcastState(roomCode);
}

// ---------- Multiplayer-Matchmaking (zufällige Lobbys mit fester Größe) ----------
// Spieler wählen auf der Startseite "Multiplayer" + Lobby-Größe (4 oder 6) und landen in
// einer Warteschlange. Sobald genug Leute da sind (oder nach 60s Wartezeit mit min. 3
// Spielern), wird automatisch ein ganz normaler Raum erstellt - ab dann läuft alles wie
// gewohnt über die bestehende Raum-/Rundenlogik weiter.
const matchmakingQueues = { 4: [], 6: [] };
const queueStartTimes = { 4: null, 6: null };
const MATCHMAKING_WAIT_MS = 60000;
const MATCHMAKING_COUNTDOWN_MS = 15000;
const MATCHMAKING_MIN_PLAYERS = 3;

function createRoomFromMatchmaking(entries) {
  const code = genRoomCode();
  const players = entries.map(e => ({
    id: e.playerId, name: e.name, avatar: null, position: 0, socketId: e.socket.id, pushToken: null,
  }));
  rooms[code] = {
    code,
    hostId: players[0].id,
    stats: {},
    duplicateConflicts: [],
    excludeFromPoolPlayerIds: [],
    suppressRealEntry: false,
    canonicalPlayerAnswerIds: [],
    players,
    moderatorIndex: 0,
    phase: 'lobby',
    usedQuestions: [],
    usedEstimateQuestions: [],
    answers: {},
    votes: {},
    liveTyping: {},
    shuffledAnswers: [],
    currentQuestionObj: null,
    roundType: 'question',
    pendingRoundType: 'question',
    removalTimers: {},
    pendingPlayers: [],
    catchUpBonusGiven: false,
    catchUpAnnouncement: null,
    unlimitedQuestionSwaps: false,
    gameStarted: false,
    answerTimeLimitSet: false,
    answerTimeLimit: null,
    answerDeadline: null,
    answerTimerId: null,
    answerTimeExpired: false,
    boardLength: BOARD_LENGTH,
    estimateTriggerFields: scaleTriggerFields(ESTIMATE_TRIGGER_FIELDS, BOARD_LENGTH),
    drawingTriggerFields: scaleTriggerFields(DRAWING_TRIGGER_FIELDS, BOARD_LENGTH),
    foreignwordTriggerFields: scaleTriggerFields(FOREIGNWORD_TRIGGER_FIELDS, BOARD_LENGTH),
    isMultiplayerMatch: true,
  };
  entries.forEach(e => {
    e.socket.data.token = e.playerId;
    e.socket.data.roomCode = code;
    e.socket.data.matchmakingSize = null;
    e.socket.join(code);
    e.socket.emit('matchFound', { code, playerId: e.playerId });
  });
  console.log(`[Matchmaking] Raum ${code} erstellt mit ${players.length} zufällig gematchten Spielern.`);
  broadcastState(code);
}

function broadcastMatchmakingStatus(size) {
  const queue = matchmakingQueues[size];
  if (queue.length === 0) return;
  const timerRunning = !!queueStartTimes[size];
  const elapsed = timerRunning ? Date.now() - queueStartTimes[size] : 0;
  const secondsLeft = timerRunning ? Math.max(0, Math.ceil((MATCHMAKING_WAIT_MS - elapsed) / 1000)) : null;
  queue.forEach(e => {
    e.socket.emit('matchmakingStatus', {
      waitingCount: queue.length,
      targetSize: size,
      secondsLeft,
      showCountdown: timerRunning && secondsLeft * 1000 <= MATCHMAKING_COUNTDOWN_MS,
    });
  });
}

// Läuft im Hintergrund einmal pro Sekunde: prüft beide Warteschlangen-Größen (4 und 6)
setInterval(() => {
  [4, 6].forEach((size) => {
    const queue = matchmakingQueues[size];
    if (queue.length === 0) {
      queueStartTimes[size] = null;
      return;
    }

    if (queue.length >= size) {
      const matched = queue.splice(0, size);
      queueStartTimes[size] = null;
      createRoomFromMatchmaking(matched);
      return;
    }

    // Der 60-Sekunden-Timer läuft erst los, sobald mindestens 3 Spieler warten - bei
    // 1-2 Wartenden gibt es keinen Sinn zu starten, also einfach weiter warten ohne Countdown.
    if (queue.length >= MATCHMAKING_MIN_PLAYERS) {
      if (!queueStartTimes[size]) queueStartTimes[size] = Date.now();
      const elapsed = Date.now() - queueStartTimes[size];
      if (elapsed >= MATCHMAKING_WAIT_MS) {
        const matched = queue.splice(0, queue.length);
        queueStartTimes[size] = null;
        createRoomFromMatchmaking(matched);
        return;
      }
    } else {
      queueStartTimes[size] = null;
    }
    broadcastMatchmakingStatus(size);
  });
}, 1000);

function removeFromAllMatchmakingQueues(socketId) {
  [4, 6].forEach((size) => {
    const before = matchmakingQueues[size].length;
    matchmakingQueues[size] = matchmakingQueues[size].filter(e => e.socket.id !== socketId);
    if (matchmakingQueues[size].length !== before) {
      if (matchmakingQueues[size].length === 0) queueStartTimes[size] = null;
      broadcastMatchmakingStatus(size);
    }
  });
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, avatar, token, board28 }) => {
    const code = genRoomCode();
    const playerId = token || crypto.randomUUID();
    socket.data.token = playerId;
    socket.data.roomCode = code;
    const player = { id: playerId, name: name || 'Spieler', avatar: avatar || '💎', position: 0, socketId: socket.id, pushToken: null };
    const boardLength = board28 ? 28 : BOARD_LENGTH;
    rooms[code] = {
      code,
      hostId: playerId,
      stats: {},
      duplicateConflicts: [],
      excludeFromPoolPlayerIds: [],
      suppressRealEntry: false,
      canonicalPlayerAnswerIds: [],
      players: [player],
      moderatorIndex: 0,
      phase: 'lobby',
      usedQuestions: [],
      usedEstimateQuestions: [],
      answers: {},
      votes: {},
      liveTyping: {},
      shuffledAnswers: [],
      currentQuestionObj: null,
      roundType: 'question',
      pendingRoundType: 'question',
      removalTimers: {},
      pendingPlayers: [],
      catchUpBonusGiven: false,
      catchUpAnnouncement: null,
      unlimitedQuestionSwaps: false,
      gameStarted: false,
      answerTimeLimitSet: false,
      answerTimeLimit: null,
      answerDeadline: null,
      answerTimerId: null,
      answerTimeExpired: false,
      boardLength,
      estimateTriggerFields: scaleTriggerFields(ESTIMATE_TRIGGER_FIELDS, boardLength),
      drawingTriggerFields: scaleTriggerFields(DRAWING_TRIGGER_FIELDS, boardLength),
      foreignwordTriggerFields: scaleTriggerFields(FOREIGNWORD_TRIGGER_FIELDS, boardLength),
    };
    console.log(`[Raum erstellt] Code=${code} von Spieler "${name}". Aktive Räume: ${Object.keys(rooms).join(', ')}`);
    socket.join(code);
    socket.emit('joined', { code, playerId });
    broadcastState(code);
  });

  // ---- Multiplayer-Matchmaking: zufälliger Lobby-Beitritt ----
  socket.on('joinMatchmaking', ({ name, lobbySize, token }) => {
    const size = [4, 6].includes(lobbySize) ? lobbySize : 4;
    const playerId = token || crypto.randomUUID();
    socket.data.matchmakingSize = size;
    matchmakingQueues[size].push({ socket, playerId, name: (name || 'Spieler').trim() || 'Spieler', queuedAt: Date.now() });
    console.log(`[Matchmaking] "${name}" tritt ${size}er-Warteschlange bei (${matchmakingQueues[size].length}/${size}).`);
    broadcastMatchmakingStatus(size);
  });

  socket.on('cancelMatchmaking', () => {
    removeFromAllMatchmakingQueues(socket.id);
    socket.data.matchmakingSize = null;
  });

  // Nach dem Matchmaking-Match: Spieler wählen ihre Spielfigur erst, sobald sie sich
  // gegenseitig in der Lobby sehen (verhindert Doppelwahl vor dem eigentlichen Matching).
  socket.on('chooseAvatar', ({ code, avatar }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'lobby') return;
    const player = room.players.find(p => p.id === socket.data.token);
    if (!player) return;
    const taken = room.players.some(p => p.id !== player.id && p.avatar === avatar);
    if (taken) {
      socket.emit('avatarTaken', { takenAvatars: room.players.filter(p => p.avatar).map(p => p.avatar) });
      return;
    }
    player.avatar = avatar;
    broadcastState(code);
  });

  socket.on('joinRoom', ({ name, code, avatar, token }) => {
    const room = rooms[code];
    if (!room) {
      console.log(`[Beitreten fehlgeschlagen] Code="${code}" nicht gefunden. Aktuell bekannte Räume: ${Object.keys(rooms).join(', ') || '(keine)'}`);
      socket.emit('errorMsg', 'Raum nicht gefunden. Prüfe den Code.');
      return;
    }
    // WICHTIG: das Spiel kehrt zwischen JEDER Runde kurz in die Phase "lobby" zurück
    // (Moderator-Wechsel), bevor die nächste Runde beginnt - "phase !== 'lobby'" allein war
    // bisher die Bedingung, um einen getrennten Spieler wiederzuerkennen. Trennte sich
    // jemand ausgerechnet in diesem kurzen Zwischen-Runden-Moment (oder blieb dort einfach
    // hängen), griff die Wiedereinstiegs-Erkennung NICHT, und ein Beitritt mit demselben
    // Namen wurde entweder abgelehnt ("Name schon vergeben", solange der alte Eintrag noch
    // da war) oder - nach Ablauf der Karenzzeit - als KOMPLETT NEUER Spieler mit Position 0
    // behandelt, wodurch der ursprüngliche Punktestand/die Position verloren ging. Die
    // Erkennung muss daher auch in der Zwischen-Runden-Lobby greifen (gameStarted === true),
    // nicht nur außerhalb der Lobby-Phase.
    const nameNormalized = (name || '').trim().toLowerCase();
    const disconnectedMatch = room.players.find(
      p => !p.socketId && p.name.trim().toLowerCase() === nameNormalized
    );
    if (room.phase !== 'lobby') {
      // Spiel läuft schon (mitten in einer Runde) - prüfen, ob der Name zu einem
      // getrennten Spieler passt
      if (disconnectedMatch) {
        socket.emit('reclaimAvailable', { code, existingPlayerId: disconnectedMatch.id, existingName: disconnectedMatch.name });
        return;
      }
      // Kein Reconnect-Match → als Pending-Spieler vormerken (joinWhenReady-Flow)
      socket.emit('errorMsg', 'Spiel läuft schon. Nutze "Vormerken" um der nächsten Runde beizutreten.');
      return;
    }
    if (room.gameStarted && disconnectedMatch) {
      // Zwischen-Runden-Lobby: das ist kein "neuer" Spieler, sondern jemand, der genau in
      // diesem kurzen Moment die Verbindung verloren hat - Position/Punkte müssen erhalten
      // bleiben.
      socket.emit('reclaimAvailable', { code, existingPlayerId: disconnectedMatch.id, existingName: disconnectedMatch.name });
      return;
    }
    const taken = getTakenAvatars(room);
    if (taken.includes(avatar)) {
      socket.emit('avatarTaken', { takenAvatars: taken });
      return;
    }
    // Name darf in der Lobby nicht doppelt vorkommen
    const nameNorm = (name || '').trim().toLowerCase();
    const nameTaken = room.players.some(p => p.name.trim().toLowerCase() === nameNorm);
    if (nameTaken) {
      socket.emit('nameTaken', { name: (name || '').trim() });
      return;
    }
    const playerId = token || crypto.randomUUID();
    socket.data.token = playerId;
    socket.data.roomCode = code;
    room.players.push({ id: playerId, name: name || 'Spieler', avatar: avatar || '💎', position: 0, socketId: socket.id, pushToken: null });
    socket.join(code);
    socket.emit('joined', { code, playerId });
    broadcastState(code);
  });

  // Erlaubt es einem Spieler, seinen Namen zu korrigieren, falls er sich beim ersten Mal
  // vertippt hat - aber NUR solange das Spiel noch nicht gestartet wurde (also vor Runde 1).
  // Danach bleibt der Name fix, da er dann schon in Punkteliste/Statistiken auftauchen kann.
  socket.on('renamePlayer', ({ code, newName }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.phase !== 'lobby' || room.gameStarted) {
      socket.emit('errorMsg', 'Der Name kann nur vor dem Start der ersten Runde geändert werden.');
      return;
    }
    const playerId = socket.data.token;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    const trimmed = (newName || '').trim().slice(0, 16);
    if (!trimmed) return;
    if (trimmed.trim().toLowerCase() === player.name.trim().toLowerCase()) return; // keine Änderung
    const nameNorm = trimmed.toLowerCase();
    const nameTaken = room.players.some(p => p.id !== playerId && p.name.trim().toLowerCase() === nameNorm);
    if (nameTaken) {
      socket.emit('errorMsg', `Der Name "${trimmed}" ist schon vergeben.`);
      return;
    }
    console.log(`[Umbenennen] "${player.name}" -> "${trimmed}" in Raum ${code}`);
    player.name = trimmed;
    broadcastState(code);
  });

  socket.on('checkTakenAvatars', ({ code }) => {
    const room = rooms[code];
    const activeTaken = room ? getTakenAvatars(room) : [];
    const pendingTaken = room ? (room.pendingPlayers || []).map(p => p.avatar) : [];
    const allTaken = [...new Set([...activeTaken, ...pendingTaken])];
    socket.emit('takenAvatars', {
      takenAvatars: allTaken,
      roomExists: !!room,
      gameInProgress: room ? room.phase !== 'lobby' : false,
    });
  });

  // Native App (Android) meldet ihren Firebase-Push-Token, sobald einer verfügbar ist.
  // Wird beim Auslösen von Push-Benachrichtigungen (push.js) verwendet.
  socket.on('registerPushToken', ({ code, pushToken }) => {
    const room = rooms[code];
    if (!room || !socket.data.token || !pushToken) return;
    const player = room.players.find(p => p.id === socket.data.token);
    if (player) {
      player.pushToken = pushToken;
      console.log(`[Push] Token registriert für Spieler "${player.name}" in Raum ${code}`);
    }
  });

  socket.on('rejoinRoom', ({ code, token }) => {
    const room = rooms[code];
    if (!room || !token) {
      socket.emit('rejoinFailed');
      return;
    }
    const player = room.players.find(p => p.id === token);
    if (!player) {
      socket.emit('rejoinFailed');
      return;
    }
    // Geplantes Entfernen abbrechen, falls der Spieler rechtzeitig zurückkommt
    if (room.removalTimers[token]) {
      clearTimeout(room.removalTimers[token]);
      delete room.removalTimers[token];
    }
    player.socketId = socket.id;
    socket.data.token = token;
    socket.data.roomCode = code;
    socket.join(code);
    socket.emit('joined', { code, playerId: token });
    broadcastState(code);
  });

  // Wenn jemand mitten im laufenden Spiel beitreten will und der Name zu einem getrennten
  // Spieler passt (z.B. Tab geschlossen, App beendet, neues Gerät): nach Bestätigung wird
  // dessen Platz übernommen, inklusive Position, Punkte und Rolle - kein Neustart nötig
  socket.on('confirmReclaim', ({ code, existingPlayerId }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('rejoinFailed');
      return;
    }
    const player = room.players.find(p => p.id === existingPlayerId);
    if (!player || player.socketId) {
      // Zwischenzeitlich schon wieder verbunden oder nicht mehr vorhanden
      socket.emit('errorMsg', 'Dieser Platz ist nicht mehr verfügbar.');
      return;
    }
    if (room.removalTimers[existingPlayerId]) {
      clearTimeout(room.removalTimers[existingPlayerId]);
      delete room.removalTimers[existingPlayerId];
    }
    player.socketId = socket.id;
    socket.data.token = existingPlayerId;
    socket.data.roomCode = code;
    socket.join(code);
    socket.emit('joined', { code, playerId: existingPlayerId });
    broadcastState(code);
  });

  socket.on('startRound', ({ code }) => {
    const room = rooms[code];
    if (!room || room.players.length < 3) {
      socket.emit('errorMsg', 'Mindestens 3 Spieler nötig, um zu starten.');
      return;
    }
    if (room.isMultiplayerMatch && room.players.some(p => !p.avatar)) {
      socket.emit('errorMsg', 'Alle Spieler müssen zuerst ihre Spielfigur wählen.');
      return;
    }
    const moderatorId = room.players[room.moderatorIndex].id;
    if (socket.data.token !== moderatorId) {
      socket.emit('errorMsg', 'Nur die/der Moderator:in kann die Runde starten.');
      return;
    }
    const roundType = room.pendingRoundType || 'question';
    if (roundType === 'estimate' && estimateQuestionsList.filter(q => q.reviewed === true).length === 0) {
      socket.emit('errorMsg', 'Es sind keine geprüften Schätzen-Fragen hinterlegt. Bitte über /admin.html hinzufügen bzw. prüfen.');
      return;
    }
    if (roundType === 'question' && questionsList.filter(q => q.category === 'Normale Fragen' && q.reviewed === true).length === 0) {
      socket.emit('errorMsg', 'Es sind keine geprüften Fragen hinterlegt. Bitte über /admin.html Fragen hinzufügen bzw. prüfen.');
      return;
    }
    if (roundType === 'foreignword' && questionsList.filter(q => q.category === 'Fremdwörter' && q.reviewed === true).length === 0) {
      socket.emit('errorMsg', 'Es sind keine geprüften Fremdwörter-Fragen hinterlegt. Bitte über /admin.html hinzufügen bzw. prüfen.');
      return;
    }
    if (roundType === 'drawing' && questionsList.filter(q => q.category === 'Zeichnen' && q.reviewed === true).length === 0) {
      socket.emit('errorMsg', 'Es sind keine geprüften Zeichen-Begriffe hinterlegt. Bitte über /admin.html mit Kategorie "Zeichnen" hinzufügen bzw. prüfen.');
      return;
    }
    room.roundType = roundType;
    room.gameStarted = true; // Spieleinstellungen (z.B. Antwort-Zeitlimit) sind ab jetzt fix
    room.pendingRoundType = 'question';
    room.phase = 'previewQuestion';
    room.cardDrawn = false; // erst wenn der/die Moderator:in die Karte zieht, wird die Fragen-Vorschau enthüllt
    room.answers = {};
    room.votes = {};
    room.liveTyping = {};
    room.shuffledAnswers = [];
    room.duplicateConflicts = [];
    room.excludeFromPoolPlayerIds = [];
    room.suppressRealEntry = false;
    room.canonicalPlayerAnswerIds = [];
    room.currentQuestionObj = null;
    const firstCandidate = pickNextQuestion(room, roundType, []);
    if (!firstCandidate) {
      socket.emit('errorMsg', 'Für diesen Feldtyp sind keine Fragen hinterlegt. Bitte über /admin.html hinzufügen.');
      return;
    }
    room.questionCandidates = [firstCandidate];
    room.previewIndex = 0;
    broadcastState(code);
  });

  // Host legt fest, ob und wie lange die Antwort-Phase pro Runde begrenzt ist (1 Min /
  // 2 Min / kein Limit) - nur EINMAL vor Rundenstart 1 einstellbar, siehe gameStarted.
  socket.on('setAnswerTimeLimit', ({ code, seconds }) => {
    const room = rooms[code];
    if (!room) return;
    if (socket.data.token !== room.hostId && !socket.data.isSuperAdmin) return;
    if (room.gameStarted && !socket.data.isSuperAdmin) return; // nach Rundenstart 1 nicht mehr änderbar
    const allowed = [60, 120, null];
    if (!allowed.includes(seconds)) return;
    room.answerTimeLimit = seconds;
    room.answerTimeLimitSet = true;
    broadcastState(code);
  });

  // Host kann den Fragenpool-Engpass umgehen: statt max. 2x (3 Fragen insgesamt) darf der
  // Moderator dann beliebig oft durch die Fragen der Kategorie durchskippen, um Dopplungen
  // zu vermeiden, solange der Fragenpool noch klein ist.
  socket.on('setUnlimitedQuestionSwaps', ({ code, enabled }) => {
    const room = rooms[code];
    if (!room) return;
    if (socket.data.token !== room.hostId && !socket.data.isSuperAdmin) return;
    room.unlimitedQuestionSwaps = !!enabled;
    broadcastState(code);
  });

  // ---- Fragen-Vorschau: der/die Moderator:in sieht die Frage zuerst und kann sie vor
  // dem eigentlichen Rundenstart bis zu 2x austauschen (max. 3 Kandidaten insgesamt) und
  // zwischen bereits gezogenen Kandidaten frei hin- und herwechseln. ----
  socket.on('previewOtherQuestion', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.phase !== 'previewQuestion') return;
    if (!room.questionCandidates) room.questionCandidates = [];
    if (!room.unlimitedQuestionSwaps && room.questionCandidates.length >= 3) {
      socket.emit('errorMsg', 'Maximal 2x austauschen möglich (3 Fragen insgesamt). Der Host kann in den Einstellungen unbegrenztes Durchskippen aktivieren.');
      return;
    }
    const excludeIndices = room.questionCandidates.map(c => c.index);
    const next = pickNextQuestion(room, room.roundType, excludeIndices);
    if (!next) {
      socket.emit('errorMsg', 'Keine weitere Frage in dieser Kategorie verfügbar.');
      return;
    }
    room.questionCandidates.push(next);
    room.previewIndex = room.questionCandidates.length - 1;
    broadcastState(code);
  });

  socket.on('selectPreviewCandidate', ({ code, index }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.phase !== 'previewQuestion') return;
    if (!room.questionCandidates || index < 0 || index >= room.questionCandidates.length) return;
    room.previewIndex = index;
    broadcastState(code);
  });

  // Moderator:in zieht sichtbar für ALLE die Karte vom Stapel (3D-Animation) - erst danach
  // wird die eigentliche Fragen-Vorschau (Frage lesen, ggf. austauschen) enthüllt.
  socket.on('triggerCardDraw', ({ code }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'previewQuestion' || room.cardDrawn) return;
    if (!isModerator(room, socket)) return;
    room.cardDrawn = true;
    broadcastState(code);
  });

  // Admin-Werkzeug: löst den Kartenzug aus, unabhängig davon, wer gerade Moderator:in ist -
  // praktisch zum Testen, ohne extra die Moderatorrolle übernehmen zu müssen.
  socket.on('adminTriggerCardDraw', ({ code }) => {
    const room = rooms[code];
    if (!room || !socket.data.isSuperAdmin) return;
    if (room.phase !== 'previewQuestion' || room.cardDrawn) return;
    room.cardDrawn = true;
    broadcastState(code);
  });

  socket.on('confirmQuestion', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.phase !== 'previewQuestion') return;
    if (!room.questionCandidates || room.questionCandidates.length === 0) return;
    const chosen = room.questionCandidates[room.previewIndex] || room.questionCandidates[0];
    const usedKey = room.roundType === 'estimate' ? 'usedEstimateQuestions'
      : room.roundType === 'foreignword' ? 'usedForeignwordQuestions'
      : room.roundType === 'drawing' ? 'usedDrawTerms'
      : 'usedQuestions';
    if (!room[usedKey]) room[usedKey] = [];
    if (!room[usedKey].includes(chosen.index)) room[usedKey].push(chosen.index);

    room.currentQuestionObj = chosen;
    room.questionCandidates = [];
    room.previewIndex = 0;
    const moderatorId = room.players[room.moderatorIndex].id;

    if (room.roundType === 'drawing') {
      room.drawingRoundId = (room.drawingRoundId || 0) + 1;
      // NEU: erst ein Zwischenscreen, auf dem alle Mitspieler (außer dem/der Moderator:in,
      // der/die ja selbst zeichnet) ihre Anwesenheit bestätigen müssen - die eigentliche
      // Zeichnenrunde (inkl. Zeit-Sperre fürs "Runde beenden") startet erst danach.
      room.phase = 'drawingPresence';
      room.presenceConfirmed = {};
      broadcastState(code);
      const guessers = room.players.filter(p => p.id !== moderatorId);
      push.notifyPlayers(guessers, 'Zeichnenrunde gleich! 🎨', 'Bitte bestätige deine Anwesenheit.', { code, type: 'drawing' });
      return;
    }

    room.phase = 'answering';
    startAnswerTimerIfNeeded(room, code);
    broadcastState(code);

    // Push: alle außer dem Moderator müssen jetzt eine Antwort abgeben
    const answerers = room.players.filter(p => p.id !== moderatorId);
    push.notifyPlayers(answerers, 'Du bist dran! 🎭', 'Gib deine Bluff-Antwort ab.', { code, type: 'answering' });
  });

  socket.on('typingAnswer', ({ code, text }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'answering') return;
    const myId = socket.data.token;
    const moderatorId = room.players[room.moderatorIndex].id;
    if (myId === moderatorId) return;
    if (!room.liveTyping) room.liveTyping = {};
    room.liveTyping[myId] = (text || '').slice(0, 140);
    broadcastState(code);
  });

  socket.on('submitAnswer', async ({ code, text }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'answering') return;
    const myId = socket.data.token;
    const moderatorId = room.players[room.moderatorIndex].id;
    if (myId === moderatorId) return; // Moderator gibt keine Antwort ab

    // Bearbeiten ist jederzeit erlaubt, solange die Antwort-Phase läuft - der/die
    // Moderator:in entscheidet manuell, wann es weitergeht (kein automatisches Sperren
    // mehr nach dem Motto "alle sind fertig", das würde jemanden mitten in einer
    // Änderung ungewollt aussperren).

    if (room.roundType === 'estimate') {
      const numericValue = Number(text);
      if (Number.isNaN(numericValue)) return;
      room.answers[myId] = numericValue;
      broadcastState(code);
      return;
    }

    const rawText = (text || '').trim().slice(0, 140);
    // WICHTIG: Keine automatische Korrektur/Umschreibung der Spieler-Antwort mehr (vorher
    // wurde jede Antwort an einen externen Grammatik-Dienst geschickt, der eigenmächtig
    // Wörter ausgetauscht/zusammengezogen hat - genau das sorgte für das Problem, dass
    // Antworten sich selbst nach Löschen/Neueingabe immer wieder "von selbst" veränderten).
    // Die Spieler-Eingabe wird jetzt 1:1 übernommen.
    const corrected = rawText;

    // Falls sich der Raum/die Phase währenddessen geändert hat, nichts mehr speichern
    const stillRoom = rooms[code];
    if (!stillRoom || stillRoom.phase !== 'answering') return;

    stillRoom.answers[myId] = corrected;
    if (stillRoom.liveTyping) delete stillRoom.liveTyping[myId];

    // Statt die Antwort abzulehnen: erlauben, aber dem Moderator zur Auflösung vorlegen,
    // falls sie (zufällig oder absichtlich) mit der echten Antwort praktisch identisch ist
    if (!stillRoom.duplicateConflicts) stillRoom.duplicateConflicts = [];
    stillRoom.duplicateConflicts = stillRoom.duplicateConflicts.filter(id => id !== myId);
    if (isTooSimilarToRealAnswer(corrected, stillRoom.currentQuestionObj.answer)) {
      stillRoom.duplicateConflicts.push(myId);
    }

    socket.emit('answerCorrected', { text: corrected, wasChanged: corrected !== rawText });
    broadcastState(code);
  });

  socket.on('resolveDuplicate', ({ code, playerId, action }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket)) return;
    if (!room.duplicateConflicts || !room.duplicateConflicts.includes(playerId)) return;

    room.duplicateConflicts = room.duplicateConflicts.filter(id => id !== playerId);

    if (action === 'keepReal') {
      // Die offizielle echte Antwort bleibt als eigener Eintrag, die (identische) Antwort
      // des Spielers wird aus dem Antwort-Pool entfernt (taucht nicht doppelt auf)
      if (!room.excludeFromPoolPlayerIds) room.excludeFromPoolPlayerIds = [];
      if (!room.excludeFromPoolPlayerIds.includes(playerId)) room.excludeFromPoolPlayerIds.push(playerId);
    } else if (action === 'keepPlayerVersion') {
      // Die Antwort des Spielers gilt als 'echte' Antwort (sinngleich zur offiziellen).
      // Die offizielle Antwort wird nicht zusaetzlich aufgefuehrt.
      room.suppressRealEntry = true;
      if (!room.canonicalPlayerAnswerIds) room.canonicalPlayerAnswerIds = [];
      if (!room.canonicalPlayerAnswerIds.includes(playerId)) {
        room.canonicalPlayerAnswerIds.push(playerId);
      }
    }
    // action === 'ignore': Fehlalarm der automatischen Ähnlichkeits-Erkennung - beide
    // Antworten bleiben ganz normal und getrennt im Pool (keine weitere Aktion nötig,
    // der Konflikt wurde oben bereits aus duplicateConflicts entfernt).

    broadcastState(code);
  });

  function startVotingPhase(room, code) {
    clearAnswerTimer(room);
    const moderator = room.players[room.moderatorIndex];
    const excluded = room.excludeFromPoolPlayerIds || [];
    const combined = [];
    if (!room.suppressRealEntry) {
      combined.push({ ownerId: 'REAL', text: room.currentQuestionObj.answer, isReal: true });
    }
    const canonicals = room.canonicalPlayerAnswerIds || [];
    room.players.forEach(p => {
      if (p.id !== moderator.id && room.answers[p.id] !== undefined && !excluded.includes(p.id)) {
        const isCanonical = canonicals.includes(p.id);
        combined.push({ ownerId: p.id, text: room.answers[p.id], isReal: isCanonical });
      }
    });
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }
    room.shuffledAnswers = combined;
    room.votePreview = {};
    room.phase = 'voting';
    broadcastState(code);

    // Push: alle außer dem Moderator müssen jetzt abstimmen
    const voters = room.players.filter(p => p.id !== moderator.id);
    push.notifyPlayers(voters, 'Du bist dran! 🗳️', 'Jetzt abstimmen, welche Antwort echt ist.', { code, type: 'voting' });
  }

  // Geht automatisch zur Abstimmung über, sobald alle geantwortet haben und keine
  // offenen Dopplungs-Konflikte mehr auf eine Moderator-Entscheidung warten
  function isModerator(room, socket) {
    return room.players[room.moderatorIndex] && room.players[room.moderatorIndex].id === socket.data.token;
  }

  // ---- Moderator kann Spieler-Antworten manuell bearbeiten/löschen (z.B. wenn eine
  // Antwort sinngleich mit der echten ist, aber im Wortlaut anders und daher von der
  // automatischen Dopplungs-Erkennung nicht erfasst wurde) ----
  socket.on('editPlayerAnswer', ({ code, playerId, newText }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.phase !== 'answering') return;
    if (room.answers[playerId] === undefined) return;
    const trimmed = (newText || '').trim();
    if (!trimmed) return;
    room.answers[playerId] = trimmed;
    broadcastState(code);
    // Dem betroffenen Spieler direkt zeigen, was geändert wurde - sonst erkennt er seine
    // eigene Antwort in der nächsten Runde nicht wieder, weil er von der Änderung nichts
    // mitbekommen hat.
    const targetPlayer = room.players.find(p => p.id === playerId);
    if (targetPlayer && targetPlayer.socketId) {
      io.to(targetPlayer.socketId).emit('yourAnswerEditedByModerator', { newText: trimmed });
    }
  });

  socket.on('deletePlayerAnswer', ({ code, playerId }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.phase !== 'answering') return;
    delete room.answers[playerId];
    // Falls diese Antwort gerade in einem offenen Dopplungs-Konflikt steckte, den auch auflösen
    if (room.duplicateConflicts) {
      room.duplicateConflicts = room.duplicateConflicts.filter(id => id !== playerId);
    }
    broadcastState(code);
    // Dem betroffenen Spieler direkt Bescheid geben, dass seine Antwort weg ist und er
    // eine neue eingeben kann (statt dass er nur ein plötzlich wieder leeres/aktives Feld
    // sieht, ohne zu wissen warum).
    const targetPlayer = room.players.find(p => p.id === playerId);
    if (targetPlayer && targetPlayer.socketId) {
      io.to(targetPlayer.socketId).emit('yourAnswerDeletedByModerator');
    }
  });

  // ==================== ZEICHENRUNDE (gelbe Felder) ====================
  // Der/die Moderator:in zeichnet den Begriff, alle anderen sehen live mit und raten
  // per Textfeld. Striche werden nur weitergeleitet (nicht serverseitig gespeichert) -
  // bewusst simpel gehalten, kein Kartenstapel-/Animations-Schnickschnack.

  socket.on('drawStroke', ({ code, x0, y0, x1, y1 }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'drawing') return;
    const moderatorId = room.players[room.moderatorIndex].id;
    if (socket.data.token !== moderatorId) return; // nur der/die Moderator:in darf zeichnen
    socket.to(code).emit('drawStroke', { x0, y0, x1, y1 });
  });

  socket.on('clearDrawing', ({ code }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'drawing') return;
    const moderatorId = room.players[room.moderatorIndex].id;
    if (socket.data.token !== moderatorId) return;
    socket.to(code).emit('clearDrawing');
  });

  socket.on('submitGuess', ({ code, guess }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'drawing') return;
    const myId = socket.data.token;
    const moderatorId = room.players[room.moderatorIndex].id;
    if (myId === moderatorId) return; // Moderator zeichnet, rät nicht mit
    if (!room.correctGuessers) room.correctGuessers = [];
    if (room.correctGuessers.includes(myId)) return; // hat schon richtig geraten
    if (room.correctGuessers.length >= DRAWING_GUESS_POINTS.length) return; // schon 2 Richtige - Runde läuft gleich aus

    const normalize = (s) => (s || '').trim().toLowerCase().replace(/[^a-zäöüß0-9 ]/gi, '');
    const isCorrect = normalize(guess) === normalize(room.currentQuestionObj.answer) && normalize(guess).length > 0;
    if (isCorrect) {
      const place = room.correctGuessers.length; // 0 = erste:r, 1 = zweite:r
      room.correctGuessers.push(myId);
      const player = room.players.find(p => p.id === myId);
      if (player) player.position = Math.min(room.boardLength || BOARD_LENGTH, player.position + DRAWING_GUESS_POINTS[place]);
      broadcastState(code);

      // Sobald die/der Erste richtig geraten hat, bekommen alle anderen (noch ratenden)
      // Mitspieler:innen eine kurze Benachrichtigung, damit sie wissen, dass es jetzt um
      // den 2. Platz geht - der Moderator zeichnet einfach weiter, bekommt also keine.
      if (place === 0 && player) {
        room.players.forEach(p => {
          if (p.id !== myId && p.id !== moderatorId && p.socketId) {
            io.to(p.socketId).emit('someoneGuessedCorrectly', { name: player.name });
          }
        });
      }

      // Sobald die ersten beiden richtig geraten haben, endet die Runde automatisch
      if (room.correctGuessers.length >= DRAWING_GUESS_POINTS.length) {
        finishDrawingRound(room, code);
      }
    } else {
      socket.emit('guessWrong', { guess });
    }
  });

  function finishDrawingRound(room, code) {
    const prevPositions = room.drawingStartPositions || {};
    room.drawingResult = {
      term: room.currentQuestionObj.answer,
      guesserNames: (room.correctGuessers || []).map(id => {
        const p = room.players.find(pp => pp.id === id);
        return p ? p.name : '???';
      }),
    };
    applyRoundTypeTriggerCheck(room, prevPositions);
    room.phase = 'reveal';
    room.revealStartedAt = Date.now();
    broadcastState(code);
    checkForWinner(code, room);
  }

  // Bevor die eigentliche Zeichnenrunde losgeht, müssen alle Mitspieler:innen (außer dem/
  // der zeichnenden Moderator:in) ihre Anwesenheit bestätigen - verhindert, dass jemand
  // mitten in der Runde noch nicht am Bildschirm ist und dadurch keine faire Chance hatte.
  socket.on('confirmDrawingPresence', ({ code }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'drawingPresence') return;
    const playerId = socket.data.token;
    const moderatorId = room.players[room.moderatorIndex].id;
    if (playerId === moderatorId) return; // Moderator zeichnet selbst, muss nicht bestätigen
    if (!room.players.find(p => p.id === playerId)) return;
    room.presenceConfirmed = room.presenceConfirmed || {};
    room.presenceConfirmed[playerId] = true;

    const guessers = room.players.filter(p => p.id !== moderatorId);
    const allConfirmed = guessers.length > 0 && guessers.every(p => room.presenceConfirmed[p.id]);
    if (allConfirmed) {
      room.phase = 'drawing';
      room.drawingStartedAt = Date.now();
      room.correctGuessers = [];
      room.guesses = {};
      // Positionen VOR der Zeichnenrunde merken, da Punkte hier laufend (nicht erst am
      // Ende) vergeben werden - für Aufhol-/Schätzen-Feld-Check am Rundenende gebraucht.
      room.drawingStartPositions = {};
      room.players.forEach(p => { room.drawingStartPositions[p.id] = p.position; });
      broadcastState(code);
      push.notifyPlayers([room.players[room.moderatorIndex]], 'Du bist dran! 🎨', 'Zeichne den Begriff.', { code, type: 'drawing-mod' });
      console.log(`[Zeichnenrunde] Alle bereit in Raum ${code} - Runde startet.`);
    } else {
      broadcastState(code);
    }
  });

  socket.on('endDrawingRound', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.phase !== 'drawing') return;
    // Serverseitig zusätzlich absichern: die ersten 60s nach Rundenstart kann die Runde
    // nicht beendet werden (der ausgegraute Button ist nur die UI-Seite davon) - schützt
    // davor, dass aus Versehen beendet wird, bevor überhaupt jemand raten konnte.
    if (room.drawingStartedAt && Date.now() - room.drawingStartedAt < 60000 && !socket.data.isSuperAdmin) return;
    finishDrawingRound(room, code);
  });

  // Ermittelt, ob gerade jemand eine bereits abgeschickte Antwort am Bearbeiten ist, ohne
  // die Änderung schon erneut abgeschickt zu haben (liveTyping weicht vom letzten
  // gespeicherten answers-Wert ab). Wird u.a. genutzt, um zu verhindern, dass der/die
  // Moderator:in mitten in so einer Bearbeitung zur Abstimmung/Auflösung weiterschaltet -
  // das hat vorher das ganze Spiel durcheinandergebracht, weil die Antwort dann verloren
  // ging bzw. der Spieler ausgesperrt wurde.
  function hasUnsavedAnswerEdits(room, moderatorId) {
    if (!room.liveTyping) return false;
    return room.players.some(p => {
      if (p.id === moderatorId) return false;
      const typing = room.liveTyping[p.id];
      if (typing === undefined) return false;
      const submitted = room.answers[p.id];
      const submittedStr = submitted === undefined ? '' : String(submitted);
      return typing !== submittedStr;
    });
  }

  socket.on('goToVoting', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket)) return;
    if (room.duplicateConflicts && room.duplicateConflicts.length > 0) {
      socket.emit('errorMsg', 'Bitte erst alle Dopplungen auflösen, bevor es zur Abstimmung geht.');
      return;
    }
    const moderatorId = room.players[room.moderatorIndex].id;
    const totalAnswerers = room.players.filter(p => p.id !== moderatorId).length;
    const answeredCount = Object.keys(room.answers).length;
    if (answeredCount < totalAnswerers && !room.answerTimeExpired) {
      socket.emit('errorMsg', 'Noch nicht alle haben geantwortet.');
      return;
    }
    // NEU: auch wenn rechnerisch schon "alle geantwortet" haben, könnte gerade jemand seine
    // bereits abgeschickte Antwort überarbeiten (Feld angeklickt/getippt, aber noch nicht neu
    // abgeschickt) - in diesem Zustand darf es NICHT weitergehen, sonst geht die gerade
    // eingetippte Änderung verloren. Auch das zählt nur, solange die Zeit nicht schon
    // abgelaufen ist (Zeitlimit bleibt ein harter Cutoff, wie schon beim Grundcheck oben).
    if (!room.answerTimeExpired && hasUnsavedAnswerEdits(room, moderatorId)) {
      socket.emit('errorMsg', 'Ein Spieler bearbeitet gerade noch seine Antwort – bitte kurz warten.');
      return;
    }
    startVotingPhase(room, code);
  });

  // ---- PENDING JOIN: Beitreten vormerken, solange Spiel läuft ----
  // Spieler kann Name + Avatar wählen und wird gemerkt. Sobald nextRound
  // aufgerufen wird und alle in die Lobby zurückkehren, wird er automatisch
  // eingelassen und bekommt sein 'joined'-Event.
  socket.on('joinWhenReady', ({ name, code, avatar, token }) => {
    const room = rooms[code];
    if (!room) { socket.emit('errorMsg', 'Raum nicht gefunden.'); return; }

    // Wenn das Spiel doch schon in der Lobby ist, direkt beitreten
    if (room.phase === 'lobby') {
      const taken = getTakenAvatars(room);
      if (taken.includes(avatar)) { socket.emit('avatarTaken', { takenAvatars: taken }); return; }
      const nameNorm = (name || '').trim().toLowerCase();
      if (room.players.some(p => p.name.trim().toLowerCase() === nameNorm)) {
        socket.emit('nameTaken', { name: (name || '').trim() }); return;
      }
      const playerId = token || crypto.randomUUID();
      socket.data.token = playerId;
      socket.data.roomCode = code;
      room.players.push({ id: playerId, name: name || 'Spieler', avatar: avatar || '💎', position: 0, socketId: socket.id, pushToken: null });
      socket.join(code);
      socket.emit('joined', { code, playerId });
      broadcastState(code);
      return;
    }

    // Spiel läuft noch → Vormerken
    if (!room.pendingPlayers) room.pendingPlayers = [];

    // Name darf nicht doppelt vorkommen (aktiv oder pending)
    const nameNorm = (name || '').trim().toLowerCase();
    const nameByActive = room.players.some(p => p.name.trim().toLowerCase() === nameNorm);
    const nameByPending = room.pendingPlayers.some(p => p.name.trim().toLowerCase() === nameNorm);
    if (nameByActive || nameByPending) {
      socket.emit('nameTaken', { name: (name || '').trim() }); return;
    }

    // Avatar darf nicht doppelt vergeben sein (aktiv oder pending)
    const takenByActive = getTakenAvatars(room);
    const takenByPending = room.pendingPlayers.map(p => p.avatar);
    if (takenByActive.includes(avatar) || takenByPending.includes(avatar)) {
      const all = [...new Set([...takenByActive, ...takenByPending])];
      socket.emit('avatarTaken', { takenAvatars: all });
      return;
    }

    const playerId = token || crypto.randomUUID();
    socket.data.token = playerId;
    socket.data.roomCode = code;
    socket.join(code);

    room.pendingPlayers.push({ id: playerId, name: name || 'Spieler', avatar: avatar || '💎', socketId: socket.id });
    socket.emit('pendingJoinQueued', { code, playerId });
    broadcastState(code);
  });

  socket.on('cancelPendingJoin', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const token = socket.data.token;
    if (room.pendingPlayers) {
      room.pendingPlayers = room.pendingPlayers.filter(p => p.id !== token);
    }
    socket.leave(code);
    socket.data.roomCode = null;
    broadcastState(code);
  });

  // Zeigt der Moderation schon vor dem Abschicken, welche Antwort ein Spieler gerade antippt
  socket.on('previewVote', ({ code, chosenOwnerId }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'voting') return;
    const myId = socket.data.token;
    const moderatorId = room.players[room.moderatorIndex].id;
    if (myId === moderatorId) return;
    if (!room.votePreview) room.votePreview = {};
    room.votePreview[myId] = chosenOwnerId;
    broadcastState(code);
  });

  socket.on('submitVote', ({ code, chosenOwnerId }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'voting') return;
    const myId = socket.data.token;
    const moderatorId = room.players[room.moderatorIndex].id;
    if (myId === moderatorId) return; // Moderator stimmt nicht ab
    if (chosenOwnerId === myId) {
      // Sollte durch die Client-UI (eigene Antwort nicht anklickbar) gar nicht erst
      // vorkommen - trotzdem serverseitig abgesichert. WICHTIG: nicht mehr "still" ablehnen
      // (das führte dazu, dass der Client trotzdem optimistisch "abgeschickt" anzeigte,
      // obwohl serverseitig gar nichts gespeichert wurde) - stattdessen aktiv Bescheid geben.
      socket.emit('voteRejected', { reason: 'Du kannst nicht für deine eigene Antwort abstimmen.' });
      return;
    }

    const totalVoters = room.players.filter(p => p.id !== moderatorId).length;
    const alreadyVoted = room.votes[myId] !== undefined;
    const currentVotedCount = Object.keys(room.votes).length;
    // Sobald ALLE abgestimmt haben, ist keine Änderung mehr möglich (auch nicht für den
    // letzten, der gerade fertig wurde) - nur der allererste Eintrag von jemandem darf
    // noch durch, solange er/sie selbst noch nicht Teil des "alle fertig"-Standes war.
    if (alreadyVoted && currentVotedCount >= totalVoters) {
      socket.emit('voteLocked', { reason: 'Alle haben schon abgestimmt – Änderungen sind nicht mehr möglich.' });
      return;
    }

    room.votes[myId] = chosenOwnerId;
    broadcastState(code);
  });

  socket.on('revealResults', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.roundType === 'estimate') return;

    // Alle Nicht-Moderatoren müssen abgestimmt haben
    const moderatorId = room.players[room.moderatorIndex].id;
    const voters = room.players.filter(p => p.id !== moderatorId);
    const missingVotes = voters.filter(p => room.votes[p.id] === undefined && p.socketId); // getrennte Spieler blockieren nicht
    if (missingVotes.length > 0) {
      const names = missingVotes.map(p => p.name).join(', ');
      socket.emit('errorMsg', `Noch nicht alle haben abgestimmt: ${names}`);
      return;
    }

    const prevPositions = {};
    room.players.forEach(p => { prevPositions[p.id] = p.position; });

    // Kanonische Spieler-Antworten: der Mod hat eine Spieler-Version als sinngleich zur
    // echten Antwort akzeptiert und die offizielle verworfen. Stimmen darauf zaehlen als
    // "richtig geraten" (Wähler +Punkte), NICHT als "geblendet".
    const canonicals = room.canonicalPlayerAnswerIds || [];
    function isCorrectAnswer(chosenOwnerId) {
      return chosenOwnerId === 'REAL' || canonicals.includes(chosenOwnerId);
    }

    // Punkte berechnen
    for (const [voterId, chosenOwnerId] of Object.entries(room.votes)) {
      if (isCorrectAnswer(chosenOwnerId)) {
        // Richtige Antwort gewählt -> Wähler bekommt Punkte
        const player = room.players.find(p => p.id === voterId);
        if (player) player.position = Math.min(room.boardLength || BOARD_LENGTH, player.position + POINTS_CORRECT_GUESS);
      } else {
        // Erfundene Antwort gewählt -> Antworter bekommt Bluff-Punkte
        const fooledOwner = room.players.find(p => p.id === chosenOwnerId);
        if (fooledOwner && fooledOwner.id !== voterId) {
          fooledOwner.position = Math.min(room.boardLength || BOARD_LENGTH, fooledOwner.position + POINTS_PER_FOOLED_PLAYER);
          ensureStats(room, fooledOwner.id).fooled += 1;
          ensureStats(room, voterId).timesFooled += 1;
        }
      }
    }

    // Für jede erfundene Antwort merken, wer darauf reingefallen ist (für die Anzeige)
    room.shuffledAnswers.forEach(a => {
      if (a.isReal) {
        const correctIds = Object.entries(room.votes).filter(([, v]) => v === a.ownerId).map(([voterId]) => voterId);
        a.correctGuesserIds = correctIds;
        a.correctGuesserNames = correctIds.map(id => (room.players.find(p => p.id === id) || {}).name || '???');
      } else {
        const foolerIds = Object.entries(room.votes).filter(([, v]) => v === a.ownerId).map(([voterId]) => voterId);
        a.foolCount = foolerIds.length;
        a.foolerIds = foolerIds;
        a.foolerNames = foolerIds.map(id => (room.players.find(p => p.id === id) || {}).name || '???');
        // Eigene Stimme auf die eigene Antwort zählt zwar für die "X ist reingefallen"-Anzeige
        // mit, bringt aber keine Punkte (siehe Scoring oben) - das muss auch die
        // Punkte-Anzeige korrekt widerspiegeln, statt fälschlich Punkte zu suggerieren.
        a.pointsAwardedFoolCount = foolerIds.filter(id => id !== a.ownerId).length;
      }
    });

    applyCatchUpBonus(room);
    applyRoundTypeTriggerCheck(room, prevPositions);
    room.phase = 'reveal';
    room.revealStartedAt = Date.now();
    broadcastState(code);
    room.catchUpAnnouncement = null; // nur einmalig in der Ansage anzeigen
    checkForWinner(code, room);
  });

  // Für Schätzen-Runden: kein Voting, direkte Auswertung nach Nähe zur echten Zahl
  socket.on('revealEstimate', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.roundType !== 'estimate') return;
    const moderatorIdForEdit = room.players[room.moderatorIndex].id;
    if (!room.answerTimeExpired && hasUnsavedAnswerEdits(room, moderatorIdForEdit)) {
      socket.emit('errorMsg', 'Ein Spieler bearbeitet gerade noch seine Schätzung – bitte kurz warten.');
      return;
    }
    clearAnswerTimer(room);

    const prevPositions = {};
    room.players.forEach(p => { prevPositions[p.id] = p.position; });

    const realValue = Number(room.currentQuestionObj.answer);
    const moderatorId = room.players[room.moderatorIndex].id;
    const ranked = Object.entries(room.answers)
      .filter(([playerId]) => playerId !== moderatorId)
      .map(([playerId, value]) => ({ playerId, value: Number(value), diff: Math.abs(Number(value) - realValue) }))
      .sort((a, b) => a.diff - b.diff);

    // Punkte je Rang vergeben - bei exakt gleicher Abweichung (typischerweise: zwei
    // Spieler:innen haben denselben Wert getippt) bekommt der/die Zweite denselben Rang-
    // Index wie der/die Erste, damit garantiert dieselbe Punktzahl herauskommt, statt durch
    // Zufall bei der Sortierung 2 statt 1 Punkte weniger zu bekommen ("erste zwei = gleich
    // gut geschätzt = gleich viele Punkte").
    let lastDiff = null;
    let lastPointsIndex = -1;
    ranked.forEach((entry, i) => {
      const pointsIndex = (lastDiff !== null && entry.diff === lastDiff) ? lastPointsIndex : i;
      lastDiff = entry.diff;
      lastPointsIndex = pointsIndex;
      entry.pointsIndex = pointsIndex;
      const points = ESTIMATE_POINTS[pointsIndex] || 0;
      if (points > 0) {
        const player = room.players.find(p => p.id === entry.playerId);
        if (player) player.position = Math.min(room.boardLength || BOARD_LENGTH, player.position + points);
        if (pointsIndex === 0) ensureStats(room, entry.playerId).estimateBest += 1;
      }
    });

    // Für die Auflösungs-Anzeige im Client aufbereiten (Rang, Name, Wert, Punkte)
    room.estimateResults = ranked.map((entry, i) => {
      const player = room.players.find(p => p.id === entry.playerId);
      return {
        rank: i + 1,
        name: player ? player.name : '???',
        value: entry.value,
        diff: entry.diff,
        points: ESTIMATE_POINTS[entry.pointsIndex] || 0,
      };
    });

    applyCatchUpBonus(room);
    applyRoundTypeTriggerCheck(room, prevPositions);
    room.phase = 'reveal';
    room.revealStartedAt = Date.now();
    broadcastState(code);
    room.catchUpAnnouncement = null; // nur einmalig in der Ansage anzeigen
    checkForWinner(code, room);
  });

  socket.on('showBoard', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket)) return;
    // Serverseitig absichern (nicht nur der ausgegraute Button auf dem Client): der
    // Auflösungs-Screen muss mindestens X Sekunden sichtbar gewesen sein, damit alle
    // Mitspieler:innen wenigstens kurz lesen können, was gerade passiert ist. Bei
    // Zeichenrunden kürzer (5s) als bei den anderen Rundentypen (8s), da man dort ja schon
    // während der ganzen Zeichenrunde live mitverfolgt hat, was passiert ist - die
    // Auflösung bringt weniger neue Information als bei einer Bluff-Frage.
    const minWaitMs = room.roundType === 'drawing' ? 5000 : 8000;
    if (room.revealStartedAt && Date.now() - room.revealStartedAt < minWaitMs && !socket.data.isSuperAdmin) return;
    room.phase = 'board';
    broadcastState(code);
  });

  socket.on('nextRound', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket)) return;
    room.moderatorIndex = (room.moderatorIndex + 1) % room.players.length;
    const newModerator = room.players[room.moderatorIndex];
    room.answers = {};
    room.votes = {};
    room.liveTyping = {};
    room.shuffledAnswers = [];
    room.correctGuessers = [];
    room.drawingResult = null;
    room.drawingStartPositions = {};
    room.adminForcedFromPositions = null;
    clearAnswerTimer(room);
    room.phase = 'lobby';

    // Vorgemerkte Spieler jetzt automatisch einlassen
    if (room.pendingPlayers && room.pendingPlayers.length > 0) {
      room.pendingPlayers.forEach(pending => {
        room.players.push({
          id: pending.id,
          name: pending.name,
          avatar: pending.avatar,
          position: 0,
          socketId: pending.socketId,
        });
        // Dem wartenden Spieler sagen: du bist drin!
        const pendingSocket = io.sockets.sockets.get(pending.socketId);
        if (pendingSocket) {
          pendingSocket.emit('joined', { code, playerId: pending.id });
        }
      });
      room.pendingPlayers = [];
    }

    broadcastState(code);

    // Push: der/die neue Moderator:in ist jetzt dran, die nächste Runde zu starten
    push.notifyPlayers([newModerator], 'Du bist dran! 🎤', 'Du moderierst die nächste Runde.', { code, type: 'moderating' });
  });

  socket.on('newGameSameLobby', ({ code }) => {
    const room = rooms[code];
    if (!room || !room.gameOverInfo) return; // nur nach einem beendeten Spiel nutzbar
    const token = socket.data.token;
    if (!room.players.some(p => p.id === token)) return; // nur Mitglieder dieses Raums

    room.players.forEach(p => { p.position = 0; });
    room.moderatorIndex = 0;
    room.stats = {};
    room.answers = {};
    room.votes = {};
    room.liveTyping = {};
    room.shuffledAnswers = [];
    room.duplicateConflicts = [];
    room.excludeFromPoolPlayerIds = [];
    room.suppressRealEntry = false;
    room.canonicalPlayerAnswerIds = [];
    room.usedQuestions = [];
    room.usedEstimateQuestions = [];
    room.currentQuestionObj = null;
    room.roundType = 'question';
    room.pendingRoundType = 'question';
    room.catchUpBonusGiven = false;
    room.catchUpAnnouncement = null;
    room.gameOverInfo = null;
    room.adminForcedFromPositions = null;
    room.correctGuessers = [];
    room.drawingResult = null;
    room.drawingStartPositions = {};
    room.usedDrawTerms = [];
    room.usedForeignwordQuestions = [];
    clearAnswerTimer(room);
    room.phase = 'lobby';
    broadcastState(code);
    console.log(`[Neues Spiel] Raum ${code} wurde in derselben Lobby neu gestartet.`);
  });

  socket.on('leaveRoom', ({ code }) => {
    const token = socket.data.token;
    if (!code || !token) return;
    removePlayerForGood(code, token);
    socket.leave(code);
    socket.data.token = null;
    socket.data.roomCode = null;
  });

  // ==================== IN-GAME ADMIN-TOOL (nur für dich, per Geheim-Code) ====================
  socket.on('adminAuth', ({ passcode }) => {
    const ok = !!passcode && passcode === GAME_ADMIN_CODE;
    socket.data.isSuperAdmin = ok;
    socket.emit('adminAuthResult', { success: ok });
  });

  // Setzt einen Spieler ein Feld vor das Ziel, damit man das Spielende (Board-Animation,
  // Gewinner-Popup, "Neue Runde") testen kann, ohne zehn echte Runden spielen zu müssen.
  // Nur noch über das Super-Admin-Panel auslösbar, nicht mehr für alle Spieler sichtbar.
  socket.on('adminSetNearFinish', ({ code, targetPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const room = rooms[code];
    if (!room) return;
    const target = room.players.find(p => p.id === targetPlayerId);
    if (!target) return;
    target.position = Math.max(0, (room.boardLength || BOARD_LENGTH) - 1);
    console.log(`[ADMIN-TOOL] "${target.name}" in Raum ${code} auf Feld ${target.position} gesetzt (kurz vorm Ziel).`);
    broadcastState(code);
  });

  // Super-Admin kann die aktuelle Vorschau-Frage jederzeit mit einem Klick austauschen,
  // OHNE das normale 2x-Limit (für den Fall, dass die verbleibenden Kandidaten den
  // Spieler:innen schon bekannt sind). Anders als previewOtherQuestion NICHT auf den
  // Moderator beschränkt, sondern nur auf den Super-Admin-Status geprüft.
  socket.on('adminForceSwapQuestion', ({ code }) => {
    const room = rooms[code];
    if (!room || !socket.data.isSuperAdmin) return;
    if (room.phase !== 'previewQuestion') return;
    if (!room.questionCandidates) room.questionCandidates = [];
    const excludeIndices = room.questionCandidates.map(c => c.index);
    const next = pickNextQuestion(room, room.roundType, excludeIndices);
    if (!next) {
      socket.emit('errorMsg', 'Keine weitere Frage in dieser Kategorie verfügbar.');
      return;
    }
    room.questionCandidates.push(next);
    room.previewIndex = room.questionCandidates.length - 1;
    broadcastState(code);
    console.log(`[ADMIN-TOOL] Frage in Raum ${code} zwangsweise ausgetauscht (Super-Admin).`);
  });

  socket.on('adminSkipRound', ({ code }) => {
    if (!socket.data.isSuperAdmin) return;
    const room = rooms[code];
    if (!room) return;
    // Wie ein normaler Rundenwechsel, aber jederzeit auslösbar (egal in welcher Phase
    // gerade festgehangen wird) - für den Fall, dass beim Testen mal was klemmt.
    room.moderatorIndex = (room.moderatorIndex + 1) % room.players.length;
    room.answers = {};
    room.votes = {};
    room.liveTyping = {};
    room.shuffledAnswers = [];
    room.correctGuessers = [];
    room.drawingResult = null;
    room.drawingStartPositions = {};
    room.duplicateConflicts = [];
    room.excludeFromPoolPlayerIds = [];
    room.suppressRealEntry = false;
    room.canonicalPlayerAnswerIds = [];
    room.currentQuestionObj = null;
    room.questionCandidates = [];
    room.previewIndex = 0;
    room.adminForcedFromPositions = null;
    clearAnswerTimer(room);
    room.phase = 'lobby';
    broadcastState(code);
    console.log(`[ADMIN-TOOL] Runde in Raum ${code} übersprungen.`);
  });

  // Springt sofort in den Anfang einer Zeichnenrunde (zum Testen des Zeichen-Screens),
  // ohne die Fragen-Vorschau und ohne den Begriff als "verwendet" zu markieren.
  socket.on('adminForceDrawingRound', ({ code }) => {
    if (!socket.data.isSuperAdmin) return;
    const room = rooms[code];
    if (!room || room.players.length < 2) return;
    const chosen = pickNextQuestion(room, 'drawing', []);
    if (!chosen) {
      socket.emit('errorMsg', 'Keine Zeichen-Begriffe hinterlegt (Kategorie "Zeichnen" in /admin.html befüllen).');
      return;
    }
    room.roundType = 'drawing';
    room.currentQuestionObj = chosen;
    room.questionCandidates = [];
    room.previewIndex = 0;
    room.answers = {};
    room.votes = {};
    room.correctGuessers = [];
    room.drawingResult = null;
    room.drawingStartPositions = {};
    room.players.forEach(p => { room.drawingStartPositions[p.id] = p.position; });
    room.drawingRoundId = (room.drawingRoundId || 0) + 1;
    room.drawingStartedAt = Date.now();
    room.phase = 'drawing';
    broadcastState(code);
    console.log(`[ADMIN-TOOL] Zeichnenrunde in Raum ${code} erzwungen (Test).`);
  });

  // Simuliert, dass eine komplette Runde stattgefunden hat: jede Figur macht einen
  // zufälligen Zug, dann geht's direkt zum Spielbrett - zum Testen der Brett-Animation
  // und des Spielendes, ohne eine echte Runde durchspielen zu müssen.
  socket.on('adminForceBoardRandom', ({ code }) => {
    if (!socket.data.isSuperAdmin) return;
    const room = rooms[code];
    if (!room) return;
    const prevPositions = {};
    room.players.forEach(p => { prevPositions[p.id] = p.position; });
    room.players.forEach(p => {
      const steps = Math.floor(Math.random() * 7); // 0-6 Felder, wie eine plausible echte Runde
      p.position = Math.min(room.boardLength || BOARD_LENGTH, p.position + steps);
    });
    room.adminForcedFromPositions = prevPositions;
    room.answers = {};
    room.votes = {};
    room.correctGuessers = [];
    room.drawingResult = null;
    applyRoundTypeTriggerCheck(room, prevPositions);
    room.phase = 'board';
    broadcastState(code);
    checkForWinner(code, room);
    console.log(`[ADMIN-TOOL] Zufällige Züge + Spielbrett in Raum ${code} erzwungen (Test).`);
  });

  socket.on('kickPlayer', ({ code, targetPlayerId }) => {
    const room = rooms[code];
    if (!room) return;
    if (socket.data.token !== room.hostId && !socket.data.isSuperAdmin) {
      socket.emit('errorMsg', 'Nur der Host kann Spieler entfernen.');
      return;
    }
    if (targetPlayerId === room.hostId && !socket.data.isSuperAdmin) return; // Host kann sich nicht selbst rauswerfen
    const target = room.players.find(p => p.id === targetPlayerId);
    if (target && target.socketId) {
      io.to(target.socketId).emit('kicked');
    }
    removePlayerForGood(code, targetPlayerId);
  });

  socket.on('disconnect', () => {
    removeFromAllMatchmakingQueues(socket.id);

    const code = socket.data.roomCode;
    const token = socket.data.token;
    if (!code || !token) return;
    const room = rooms[code];
    if (!room) return;

    // Pending-Spieler: einfach aus der Warteschlange entfernen
    if (room.pendingPlayers) {
      const wasPending = room.pendingPlayers.some(p => p.id === token);
      if (wasPending) {
        room.pendingPlayers = room.pendingPlayers.filter(p => p.id !== token);
        broadcastState(code);
        return;
      }
    }

    const player = room.players.find(p => p.id === token);
    if (!player || player.socketId !== socket.id) return; // schon durch neuere Verbindung ersetzt

    player.socketId = null; // Spieler bleibt im Raum, gilt aber als "getrennt"
    broadcastState(code);

    // Nach Karenzzeit endgültig entfernen, falls kein Reconnect erfolgt
    room.removalTimers[token] = setTimeout(() => {
      removePlayerForGood(code, token);
    }, DISCONNECT_GRACE_MS);
  });
});

const PORT = process.env.PORT || 3000;
initDatabase().finally(() => {
  server.listen(PORT, () => console.log(`Bedazzled läuft auf Port ${PORT}`));
});
