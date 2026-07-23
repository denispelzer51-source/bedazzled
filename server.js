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

const QUESTIONS_PATH = path.join(__dirname, 'questions.json');
const ESTIMATE_QUESTIONS_PATH = path.join(__dirname, 'estimate_questions.json');
const DRAW_TERMS_PATH = path.join(__dirname, 'draw_terms.json');

// ---------- Fragen-Speicherung: MongoDB Atlas, falls eingerichtet - sonst lokale Dateien ----------
// Sobald die Umgebungsvariable MONGODB_URI auf Render gesetzt ist, werden Fragen dauerhaft
// in der Datenbank gespeichert (überlebt Deploys). Ist sie nicht gesetzt, läuft alles wie
// bisher über die lokalen JSON-Dateien weiter - kein Bruch, falls die DB noch nicht bereit ist.
const MONGODB_URI = process.env.MONGODB_URI || '';
const useMongo = !!MONGODB_URI;
let mongoDb = null;

let questionsList = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));
let estimateQuestionsList = JSON.parse(fs.readFileSync(ESTIMATE_QUESTIONS_PATH, 'utf8'));
let drawTermsList = JSON.parse(fs.readFileSync(DRAW_TERMS_PATH, 'utf8'));

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
  } catch (err) {
    console.error('[DB] Verbindung zu MongoDB fehlgeschlagen, falle auf lokale Dateien zurück:', err.message);
    mongoDb = null;
  }
}

function stripId(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

const BOARD_LENGTH = 26; // Zielfeld
const POINTS_CORRECT_GUESS = 3;
const POINTS_PER_FOOLED_PLAYER = 2;
const DISCONNECT_GRACE_MS = 3 * 60 * 1000; // 3 Minuten, bevor ein getrennter Spieler endgültig entfernt wird

// Felder, die eine Schätzen-Karte statt der normalen Bluff-Frage auslösen (bewusst unregelmäßig verteilt)
const ESTIMATE_TRIGGER_FIELDS = [5, 8, 13, 18];
const ESTIMATE_POINTS = [3, 2, 1]; // Platz 1, 2, 3 – Rest geht leer aus

// Blaue Felder: Fremdwörter-Fragen (etwas seltener als die lila Standardfelder)
const FOREIGNWORD_TRIGGER_FIELDS = [2, 10, 16, 22];
// Gelbe Felder: Zeichenrunde (Moderator zeichnet einen Begriff, andere raten mit)
const DRAWING_TRIGGER_FIELDS = [4, 12, 19, 24];
const DRAWING_GUESS_POINTS = 3; // pro richtig ratendem Mitspieler

// Aufholjagd: sobald irgendjemand dieses Feld erreicht/überschreitet, bekommt der/die
// Letztplatzierte einmalig einen Bonus, damit das Spiel spannend bleibt
const CATCHUP_TRIGGER_FIELD = 18;
const CATCHUP_BONUS = 5;

// Zugangscode für die Fragen-Verwaltung (/admin.html). Auf Render als Umgebungsvariable
// ADMIN_KEY setzen, um den Standardwert zu überschreiben.
const ADMIN_KEY = process.env.ADMIN_KEY || 'bedazzled-admin';

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

async function autoCorrectGerman(text) {
  if (!text || !text.trim()) return text;
  try {
    const params = new URLSearchParams({ text, language: 'de-DE' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return text;
    const data = await res.json();
    const matches = (data.matches || []).slice().sort((a, b) => b.offset - a.offset); // rückwärts anwenden, damit Offsets stabil bleiben
    let corrected = text;
    for (const m of matches) {
      if (m.replacements && m.replacements.length > 0) {
        const replacement = m.replacements[0].value;
        corrected = corrected.slice(0, m.offset) + replacement + corrected.slice(m.offset + m.length);
      }
    }
    return corrected;
  } catch (e) {
    return text;
  }
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
    roundType: room.roundType || 'question',
    pendingRoundType: room.pendingRoundType || 'question',
    estimateTriggerFields: ESTIMATE_TRIGGER_FIELDS,
    foreignwordTriggerFields: FOREIGNWORD_TRIGGER_FIELDS,
    drawingTriggerFields: DRAWING_TRIGGER_FIELDS,
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
          canSwapMore: (room.questionCandidates || []).length < 3,
          roundType: room.roundType,
        }
      : null,
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
    shuffledAnswers: room.phase === 'voting' || room.phase === 'reveal'
      ? room.shuffledAnswers.map(a => room.phase === 'reveal' ? a : { text: a.text, ownerId: a.ownerId })
      : [],
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
    // Zeichenrunde: Moderator sieht, wer schon richtig geraten hat; Mitspieler sehen
    // nur ihren eigenen Status (nicht die anderen, um kein Rennen/Gruppenzwang zu erzeugen)
    drawingCorrectGuessers: (isModerator && room.phase === 'drawing')
      ? (room.correctGuessers || []).map(id => (room.players.find(p => p.id === id) || {}).name || '???')
      : [],
    myGuessCorrect: room.phase === 'drawing' ? (room.correctGuessers || []).includes(forPlayerId) : false,
    drawingResult: (room.phase === 'reveal' && room.drawingResult) ? room.drawingResult : null,
    catchUpAnnouncement: room.catchUpAnnouncement || null,
  };
}

function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.players.forEach(p => {
    if (p.socketId) io.to(p.socketId).emit('state', publicRoomState(room, p.id));
  });
}

function pickNextQuestion(room, roundType, excludeIndices = []) {
  if (roundType === 'drawing') return pickDrawTerm(room, excludeIndices);
  let pool, usedKey;
  if (roundType === 'estimate') {
    pool = estimateQuestionsList;
    usedKey = 'usedEstimateQuestions';
  } else if (roundType === 'foreignword') {
    // Blaue Felder: nur Fremdwörter-Fragen
    pool = questionsList.filter(q => q.category === 'Fremdwörter');
    usedKey = 'usedForeignwordQuestions';
  } else {
    // Lila Standardfelder: alles außer Fremdwörter (Kuriositäten, Historischer Kontext, etc.)
    pool = questionsList.filter(q => q.category !== 'Fremdwörter');
    usedKey = 'usedQuestions';
  }
  if (pool.length === 0) pool = questionsList; // Notfall, falls eine Kategorie leer ist

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
  return { index: idx, ...pool[idx] };
}

// Gelbe Felder: Begriff zum Zeichnen auswählen. Gibt dieselbe Form wie pickNextQuestion
// zurück (question/answer/category/topic), damit die Fragen-Vorschau unverändert
// wiederverwendet werden kann - "question" ist hier der Anzeige-Text für den/die
// Moderator:in, "answer" ist der eigentliche zu erratende Begriff.
function pickDrawTerm(room, excludeIndices = []) {
  const pool = drawTermsList;
  const usedKey = 'usedDrawTerms';
  if (!room[usedKey]) room[usedKey] = [];
  const usedOrExcluded = new Set([...room[usedKey], ...excludeIndices]);
  let available = pool.map((t, i) => i).filter(i => !usedOrExcluded.has(i));
  if (available.length === 0) {
    available = pool.map((t, i) => i).filter(i => !excludeIndices.includes(i));
    if (available.length === 0) available = pool.map((t, i) => i);
  }
  const idx = available[Math.floor(Math.random() * available.length)];
  const t = pool[idx];
  return { index: idx, question: `Zeichne: ${t.term}`, answer: t.term, category: '🎨 Zeichenrunde', topic: t.category || '' };
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
  if (movedOnto(ESTIMATE_TRIGGER_FIELDS)) room.pendingRoundType = 'estimate';
  else if (movedOnto(DRAWING_TRIGGER_FIELDS)) room.pendingRoundType = 'drawing';
  else if (movedOnto(FOREIGNWORD_TRIGGER_FIELDS)) room.pendingRoundType = 'foreignword';
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

  function topAward(key, title, emoji) {
    const max = Math.max(0, ...entries.map(([, s]) => s[key]));
    if (max === 0) return;
    const winners = entries.filter(([, s]) => s[key] === max).map(([id]) => nameFor(id)).filter(Boolean);
    if (winners.length > 0) awards.push({ title: `${emoji} ${title}`, names: winners });
  }

  topAward('fooled', 'Bester Bluffer', '🎭');
  topAward('timesFooled', 'Meist Getäuscht', '🙈');
  topAward('estimateBest', 'Schätz-Ass', '🎯');
  return awards;
}

function checkForWinner(code, room) {
  const finishers = room.players.filter(p => p.position >= BOARD_LENGTH);
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
  socket.on('createRoom', ({ name, avatar, token }) => {
    const code = genRoomCode();
    const playerId = token || crypto.randomUUID();
    socket.data.token = playerId;
    socket.data.roomCode = code;
    const player = { id: playerId, name: name || 'Spieler', avatar: avatar || '💎', position: 0, socketId: socket.id, pushToken: null };
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
    if (room.phase !== 'lobby') {
      // Spiel läuft schon - prüfen, ob der Name zu einem getrennten Spieler passt
      const nameNormalized = (name || '').trim().toLowerCase();
      const disconnectedMatch = room.players.find(
        p => !p.socketId && p.name.trim().toLowerCase() === nameNormalized
      );
      if (disconnectedMatch) {
        socket.emit('reclaimAvailable', { code, existingPlayerId: disconnectedMatch.id, existingName: disconnectedMatch.name });
        return;
      }
      // Kein Reconnect-Match → als Pending-Spieler vormerken (joinWhenReady-Flow)
      socket.emit('errorMsg', 'Spiel läuft schon. Nutze "Vormerken" um der nächsten Runde beizutreten.');
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
    if (roundType === 'estimate' && estimateQuestionsList.length === 0) {
      socket.emit('errorMsg', 'Es sind keine Schätzen-Fragen hinterlegt. Bitte über /admin.html hinzufügen.');
      return;
    }
    if (roundType === 'question' && questionsList.filter(q => q.category !== 'Fremdwörter').length === 0) {
      socket.emit('errorMsg', 'Es sind keine Fragen hinterlegt. Bitte über /admin.html Fragen hinzufügen.');
      return;
    }
    if (roundType === 'foreignword' && questionsList.filter(q => q.category === 'Fremdwörter').length === 0) {
      socket.emit('errorMsg', 'Es sind keine Fremdwörter-Fragen hinterlegt. Bitte über /admin.html hinzufügen.');
      return;
    }
    if (roundType === 'drawing' && drawTermsList.length === 0) {
      socket.emit('errorMsg', 'Es sind keine Zeichen-Begriffe hinterlegt.');
      return;
    }
    room.roundType = roundType;
    room.pendingRoundType = 'question';
    room.phase = 'previewQuestion';
    room.answers = {};
    room.votes = {};
    room.liveTyping = {};
    room.shuffledAnswers = [];
    room.duplicateConflicts = [];
    room.excludeFromPoolPlayerIds = [];
    room.suppressRealEntry = false;
    room.canonicalPlayerAnswerIds = [];
    room.currentQuestionObj = null;
    room.questionCandidates = [pickNextQuestion(room, roundType, [])];
    room.previewIndex = 0;
    broadcastState(code);
  });

  // ---- Fragen-Vorschau: der/die Moderator:in sieht die Frage zuerst und kann sie vor
  // dem eigentlichen Rundenstart bis zu 2x austauschen (max. 3 Kandidaten insgesamt) und
  // zwischen bereits gezogenen Kandidaten frei hin- und herwechseln. ----
  socket.on('previewOtherQuestion', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.phase !== 'previewQuestion') return;
    if (!room.questionCandidates) room.questionCandidates = [];
    if (room.questionCandidates.length >= 3) {
      socket.emit('errorMsg', 'Maximal 2x austauschen möglich (3 Fragen insgesamt).');
      return;
    }
    const excludeIndices = room.questionCandidates.map(c => c.index);
    const next = pickNextQuestion(room, room.roundType, excludeIndices);
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
      room.phase = 'drawing';
      room.correctGuessers = [];
      room.guesses = {};
      // Positionen VOR der Zeichenrunde merken, da Punkte hier laufend (nicht erst am
      // Ende) vergeben werden - für Aufhol-/Schätzen-Feld-Check am Rundenende gebraucht.
      room.drawingStartPositions = {};
      room.players.forEach(p => { room.drawingStartPositions[p.id] = p.position; });
      broadcastState(code);
      const guessers = room.players.filter(p => p.id !== moderatorId);
      push.notifyPlayers(guessers, 'Zeichenrunde! 🎨', 'Rate mit, was gerade gezeichnet wird.', { code, type: 'drawing' });
      push.notifyPlayers([room.players[room.moderatorIndex]], 'Du bist dran! 🎨', 'Zeichne den Begriff.', { code, type: 'drawing-mod' });
      return;
    }

    room.phase = 'answering';
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
    socket.emit('answerChecking'); // UI: "wird geprüft ..."
    const corrected = await autoCorrectGerman(rawText);

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

    const normalize = (s) => (s || '').trim().toLowerCase().replace(/[^a-zäöüß0-9 ]/gi, '');
    const isCorrect = normalize(guess) === normalize(room.currentQuestionObj.answer) && normalize(guess).length > 0;
    if (isCorrect) {
      room.correctGuessers.push(myId);
      const player = room.players.find(p => p.id === myId);
      if (player) player.position = Math.min(BOARD_LENGTH, player.position + DRAWING_GUESS_POINTS);
      broadcastState(code);
    } else {
      socket.emit('guessWrong', { guess });
    }
  });

  socket.on('endDrawingRound', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.phase !== 'drawing') return;

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
    broadcastState(code);
    checkForWinner(code, room);
  });

  socket.on('goToVoting', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket)) return;
    if (room.duplicateConflicts && room.duplicateConflicts.length > 0) {
      socket.emit('errorMsg', 'Bitte erst alle Dopplungen auflösen, bevor es zur Abstimmung geht.');
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
        if (player) player.position = Math.min(BOARD_LENGTH, player.position + POINTS_CORRECT_GUESS);
      } else {
        // Erfundene Antwort gewählt -> Antworter bekommt Bluff-Punkte
        const fooledOwner = room.players.find(p => p.id === chosenOwnerId);
        if (fooledOwner && fooledOwner.id !== voterId) {
          fooledOwner.position = Math.min(BOARD_LENGTH, fooledOwner.position + POINTS_PER_FOOLED_PLAYER);
          ensureStats(room, fooledOwner.id).fooled += 1;
          ensureStats(room, voterId).timesFooled += 1;
        }
      }
    }

    // Für jede erfundene Antwort merken, wer darauf reingefallen ist (für die Anzeige)
    room.shuffledAnswers.forEach(a => {
      if (!a.isReal) {
        const foolerIds = Object.entries(room.votes).filter(([, v]) => v === a.ownerId).map(([voterId]) => voterId);
        a.foolCount = foolerIds.length;
        a.foolerNames = foolerIds.map(id => (room.players.find(p => p.id === id) || {}).name || '???');
      }
    });

    applyCatchUpBonus(room);
    applyRoundTypeTriggerCheck(room, prevPositions);
    room.phase = 'reveal';
    broadcastState(code);
    room.catchUpAnnouncement = null; // nur einmalig in der Ansage anzeigen
    checkForWinner(code, room);
  });

  // Für Schätzen-Runden: kein Voting, direkte Auswertung nach Nähe zur echten Zahl
  socket.on('revealEstimate', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket) || room.roundType !== 'estimate') return;

    const prevPositions = {};
    room.players.forEach(p => { prevPositions[p.id] = p.position; });

    const realValue = Number(room.currentQuestionObj.answer);
    const moderatorId = room.players[room.moderatorIndex].id;
    const ranked = Object.entries(room.answers)
      .filter(([playerId]) => playerId !== moderatorId)
      .map(([playerId, value]) => ({ playerId, value: Number(value), diff: Math.abs(Number(value) - realValue) }))
      .sort((a, b) => a.diff - b.diff);

    ranked.forEach((entry, i) => {
      const points = ESTIMATE_POINTS[i] || 0;
      if (points > 0) {
        const player = room.players.find(p => p.id === entry.playerId);
        if (player) player.position = Math.min(BOARD_LENGTH, player.position + points);
        if (i === 0) ensureStats(room, entry.playerId).estimateBest += 1;
      }
    });

    // Für die Auflösungs-Anzeige im Client aufbereiten (Rang, Name, Wert, Punkte)
    room.estimateResults = ranked.map((entry, i) => {
      const player = room.players.find(p => p.id === entry.playerId);
      return {
        rank: i + 1,
        name: player ? player.name : '???',
        value: entry.value,
        points: ESTIMATE_POINTS[i] || 0,
      };
    });

    applyCatchUpBonus(room);
    applyRoundTypeTriggerCheck(room, prevPositions);
    room.phase = 'reveal';
    broadcastState(code);
    room.catchUpAnnouncement = null; // nur einmalig in der Ansage anzeigen
    checkForWinner(code, room);
  });

  socket.on('showBoard', ({ code }) => {
    const room = rooms[code];
    if (!room || !isModerator(room, socket)) return;
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

  // Nur der Host (Raum-Ersteller, unabhängig von der rotierenden Moderatorrolle) darf kicken
  // ===== DEV-TOOL: NUR ZUM TESTEN, SPÄTER WIEDER ENTFERNEN =====
  // Setzt einen Spieler ein Feld vor das Ziel, damit man das Spielende (Board-Animation,
  // Gewinner-Popup, "Neue Runde") testen kann, ohne zehn echte Runden spielen zu müssen.
  socket.on('devNearFinish', ({ code, targetPlayerId }) => {
    const room = rooms[code];
    if (!room) return;
    const target = room.players.find(p => p.id === targetPlayerId);
    if (!target) return;
    target.position = Math.max(0, BOARD_LENGTH - 1);
    console.log(`[DEV-TOOL] "${target.name}" in Raum ${code} auf Feld ${target.position} gesetzt (kurz vorm Ziel).`);
    broadcastState(code);
  });
  // ===== ENDE DEV-TOOL =====

  socket.on('kickPlayer', ({ code, targetPlayerId }) => {
    const room = rooms[code];
    if (!room) return;
    if (socket.data.token !== room.hostId) {
      socket.emit('errorMsg', 'Nur der Host kann Spieler entfernen.');
      return;
    }
    if (targetPlayerId === room.hostId) return; // Host kann sich nicht selbst rauswerfen
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
