const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const QUESTIONS_PATH = path.join(__dirname, 'questions.json');
let questionsList = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));

const ESTIMATE_QUESTIONS_PATH = path.join(__dirname, 'estimate_questions.json');
let estimateQuestionsList = JSON.parse(fs.readFileSync(ESTIMATE_QUESTIONS_PATH, 'utf8'));

const BOARD_LENGTH = 26; // Zielfeld
const POINTS_CORRECT_GUESS = 3;
const POINTS_PER_FOOLED_PLAYER = 2;
const DISCONNECT_GRACE_MS = 3 * 60 * 1000; // 3 Minuten, bevor ein getrennter Spieler endgültig entfernt wird

// Felder, die eine Schätzen-Karte statt der normalen Bluff-Frage auslösen (bewusst unregelmäßig verteilt)
const ESTIMATE_TRIGGER_FIELDS = [5, 8, 13, 18];
const ESTIMATE_POINTS = [3, 2, 1]; // Platz 1, 2, 3 – Rest geht leer aus

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
  fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(questionsList, null, 2), 'utf8');
}

function saveEstimateQuestions() {
  fs.writeFileSync(ESTIMATE_QUESTIONS_PATH, JSON.stringify(estimateQuestionsList, null, 2), 'utf8');
}

// ---------- Fragen-Verwaltung: Schätzen-Karten (Admin-API) ----------
app.get('/api/estimate-questions', checkAdmin, (req, res) => {
  res.json(estimateQuestionsList);
});

app.post('/api/estimate-questions', checkAdmin, (req, res) => {
  const { question, answer, category } = req.body || {};
  const numericAnswer = Number(answer);
  if (!question || Number.isNaN(numericAnswer)) {
    res.status(400).json({ error: 'Frage und eine numerische Antwort sind erforderlich.' });
    return;
  }
  estimateQuestionsList.push({ category: (category || 'Sonstige').trim(), question: question.trim(), answer: numericAnswer });
  saveEstimateQuestions();
  res.json(estimateQuestionsList);
});

app.put('/api/estimate-questions/:index', checkAdmin, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (!estimateQuestionsList[idx]) {
    res.status(404).json({ error: 'Frage nicht gefunden.' });
    return;
  }
  const { question, answer, category } = req.body || {};
  if (question) estimateQuestionsList[idx].question = question.trim();
  if (answer !== undefined && !Number.isNaN(Number(answer))) estimateQuestionsList[idx].answer = Number(answer);
  if (category) estimateQuestionsList[idx].category = category.trim();
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
    .map(i => ({ category: (i.category || 'Sonstige').toString().trim(), question: String(i.question).trim(), answer: Number(i.answer) }));
  if (valid.length === 0) {
    res.status(400).json({ error: 'Keine gültigen Fragen im Import gefunden.' });
    return;
  }
  estimateQuestionsList.push(...valid);
  saveEstimateQuestions();
  res.json(estimateQuestionsList);
});

// ---------- Fragen-Verwaltung: Bluff-Fragen (Admin-API) ----------
app.get('/api/questions', checkAdmin, (req, res) => {
  res.json(questionsList);
});

app.post('/api/questions', checkAdmin, (req, res) => {
  const { question, answer, category } = req.body || {};
  if (!question || !answer) {
    res.status(400).json({ error: 'Frage und Antwort sind erforderlich.' });
    return;
  }
  questionsList.push({ category: (category || 'Sonstige').trim(), question: question.trim(), answer: answer.trim() });
  saveQuestions();
  res.json(questionsList);
});

app.put('/api/questions/:index', checkAdmin, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (!questionsList[idx]) {
    res.status(404).json({ error: 'Frage nicht gefunden.' });
    return;
  }
  const { question, answer, category } = req.body || {};
  if (question) questionsList[idx].question = question.trim();
  if (answer) questionsList[idx].answer = answer.trim();
  if (category) questionsList[idx].category = category.trim();
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
    .map(i => ({ category: (i.category || 'Sonstige').toString().trim(), question: String(i.question).trim(), answer: String(i.answer).trim() }));
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
  return room.players.map(p => p.avatar);
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
    roundType: room.roundType || 'question',
    pendingRoundType: room.pendingRoundType || 'question',
    estimateTriggerFields: ESTIMATE_TRIGGER_FIELDS,
    pointsCorrectGuess: POINTS_CORRECT_GUESS,
    pointsPerFooled: POINTS_PER_FOOLED_PLAYER,
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, position: p.position, connected: !!p.socketId })),
    moderatorId,
    hostId: room.hostId,
    currentQuestion: room.phase !== 'lobby' && room.currentQuestionObj ? room.currentQuestionObj.question : null,
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
            return { name: p.name, text, submitted };
          })
      : [],
    // Damit jede:r sofort sieht, ob die eigene Wahl in der Abstimmung richtig war
    myVote: room.votes[forPlayerId] || null,
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

function pickNextQuestion(room, roundType) {
  const pool = roundType === 'estimate' ? estimateQuestionsList : questionsList;
  const usedKey = roundType === 'estimate' ? 'usedEstimateQuestions' : 'usedQuestions';
  if (!room[usedKey]) room[usedKey] = [];
  const available = pool.map((q, i) => i).filter(i => !room[usedKey].includes(i));
  const candidates = available.length > 0 ? available : pool.map((q, i) => i);
  if (available.length === 0) room[usedKey] = [];
  const idx = candidates[Math.floor(Math.random() * candidates.length)];
  room[usedKey].push(idx);
  return { index: idx, ...pool[idx] };
}

// Prüft, ob jemand durch die Punktevergabe DIESER Runde neu auf einem Schätzen-Feld
// gelandet ist (nicht: ob er zufällig schon länger dort steht). Nur ein frischer Zug auf
// eines der Felder löst die nächste Runde als Schätzen-Karte aus.
// Aufholjagd: einmalig pro Spiel, sobald jemand das Trigger-Feld erreicht/überschreitet,
// bekommt der/die Letztplatzierte (bei Gleichstand: alle Letzten) einen Bonus-Vorstoß
function applyCatchUpBonus(room) {
  if (room.catchUpBonusGiven) return;
  const anyoneAhead = room.players.some(p => p.position >= CATCHUP_TRIGGER_FIELD);
  if (!anyoneAhead) return;

  const minPos = Math.min(...room.players.map(p => p.position));
  const laggards = room.players.filter(p => p.position === minPos);
  laggards.forEach(p => {
    p.position = Math.min(BOARD_LENGTH - 1, p.position + CATCHUP_BONUS);
  });

  room.catchUpBonusGiven = true;
  room.catchUpAnnouncement = { names: laggards.map(p => p.name), amount: CATCHUP_BONUS };
}

function applyEstimateTriggerCheck(room, prevPositions) {
  const triggered = room.players.some(p =>
    ESTIMATE_TRIGGER_FIELDS.includes(p.position) && p.position !== prevPositions[p.id]
  );
  room.pendingRoundType = triggered ? 'estimate' : 'question';
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
  const winner = room.players.find(p => p.position >= BOARD_LENGTH);
  if (winner) {
    io.to(code).emit('gameOver', { winnerName: winner.name, awards: computeAwards(room) });
  }
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

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, avatar, token }) => {
    const code = genRoomCode();
    const playerId = token || crypto.randomUUID();
    socket.data.token = playerId;
    socket.data.roomCode = code;
    const player = { id: playerId, name: name || 'Spieler', avatar: avatar || '💎', position: 0, socketId: socket.id };
    rooms[code] = {
      code,
      hostId: playerId,
      stats: {},
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
      catchUpBonusGiven: false,
      catchUpAnnouncement: null,
    };
    console.log(`[Raum erstellt] Code=${code} von Spieler "${name}". Aktive Räume: ${Object.keys(rooms).join(', ')}`);
    socket.join(code);
    socket.emit('joined', { code, playerId });
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
      socket.emit('errorMsg', 'Spiel läuft schon. Bitte warte auf die nächste Runde.');
      return;
    }
    const taken = getTakenAvatars(room);
    if (taken.includes(avatar)) {
      socket.emit('avatarTaken', { takenAvatars: taken });
      return;
    }
    const playerId = token || crypto.randomUUID();
    socket.data.token = playerId;
    socket.data.roomCode = code;
    room.players.push({ id: playerId, name: name || 'Spieler', avatar: avatar || '💎', position: 0, socketId: socket.id });
    socket.join(code);
    socket.emit('joined', { code, playerId });
    broadcastState(code);
  });

  socket.on('checkTakenAvatars', ({ code }) => {
    const room = rooms[code];
    socket.emit('takenAvatars', { takenAvatars: room ? getTakenAvatars(room) : [] });
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

  socket.on('startRound', ({ code }) => {
    const room = rooms[code];
    if (!room || room.players.length < 3) {
      socket.emit('errorMsg', 'Mindestens 3 Spieler nötig, um zu starten.');
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
    if (roundType === 'question' && questionsList.length === 0) {
      socket.emit('errorMsg', 'Es sind keine Fragen hinterlegt. Bitte über /admin.html Fragen hinzufügen.');
      return;
    }
    room.roundType = roundType;
    room.pendingRoundType = 'question';
    room.phase = 'answering';
    room.answers = {};
    room.votes = {};
    room.liveTyping = {};
    room.shuffledAnswers = [];
    room.currentQuestionObj = pickNextQuestion(room, roundType);
    broadcastState(code);
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

    if (room.roundType === 'estimate') {
      const numericValue = Number(text);
      if (Number.isNaN(numericValue)) return;
      room.answers[myId] = numericValue;
      broadcastState(code);
      return;
    }

    const rawText = (text || '').trim().slice(0, 140);

    if (isTooSimilarToRealAnswer(rawText, room.currentQuestionObj.answer)) {
      socket.emit('answerRejected', { reason: 'Das ist zu ähnlich zur echten Antwort – bitte anders formulieren.' });
      return;
    }

    socket.emit('answerChecking'); // UI: "wird geprüft ..."
    const corrected = await autoCorrectGerman(rawText);

    // Falls sich der Raum/die Phase währenddessen geändert hat, nichts mehr speichern
    const stillRoom = rooms[code];
    if (!stillRoom || stillRoom.phase !== 'answering') return;

    // Nach der Rechtschreibkorrektur nochmal prüfen: manchmal macht erst die Korrektur
    // den Text verräterisch ähnlich zur echten Antwort
    if (isTooSimilarToRealAnswer(corrected, stillRoom.currentQuestionObj.answer)) {
      socket.emit('answerRejected', { reason: 'Das ist zu ähnlich zur echten Antwort – bitte anders formulieren.' });
      return;
    }

    stillRoom.answers[myId] = corrected;
    if (stillRoom.liveTyping) delete stillRoom.liveTyping[myId];
    socket.emit('answerCorrected', { text: corrected, wasChanged: corrected !== rawText });
    broadcastState(code);
  });

  socket.on('goToVoting', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const moderator = room.players[room.moderatorIndex];
    const real = { ownerId: 'REAL', text: room.currentQuestionObj.answer, isReal: true };
    const fake = room.players
      .filter(p => p.id !== moderator.id && room.answers[p.id])
      .map(p => ({ ownerId: p.id, text: room.answers[p.id], isReal: false }));
    const combined = [real, ...fake];
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }
    room.shuffledAnswers = combined;
    room.votePreview = {};
    room.phase = 'voting';
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
    room.votes[myId] = chosenOwnerId;
    broadcastState(code);
  });

  socket.on('revealResults', ({ code }) => {
    const room = rooms[code];
    if (!room || room.roundType === 'estimate') return;

    const prevPositions = {};
    room.players.forEach(p => { prevPositions[p.id] = p.position; });

    // Punkte berechnen
    for (const [voterId, chosenOwnerId] of Object.entries(room.votes)) {
      if (chosenOwnerId === 'REAL') {
        const player = room.players.find(p => p.id === voterId);
        if (player) player.position = Math.min(BOARD_LENGTH, player.position + POINTS_CORRECT_GUESS);
      } else {
        const fooledOwner = room.players.find(p => p.id === chosenOwnerId);
        if (fooledOwner && fooledOwner.id !== voterId) {
          fooledOwner.position = Math.min(BOARD_LENGTH, fooledOwner.position + POINTS_PER_FOOLED_PLAYER);
          ensureStats(room, fooledOwner.id).fooled += 1;
          ensureStats(room, voterId).timesFooled += 1;
        }
      }
    }

    // Für jede erfundene Antwort merken, wie viele Mitspieler darauf reingefallen sind (für die Anzeige)
    room.shuffledAnswers.forEach(a => {
      if (!a.isReal) {
        a.foolCount = Object.values(room.votes).filter(v => v === a.ownerId).length;
      }
    });

    applyCatchUpBonus(room);
    applyEstimateTriggerCheck(room, prevPositions);
    room.phase = 'reveal';
    broadcastState(code);
    room.catchUpAnnouncement = null; // nur einmalig in der Ansage anzeigen
    checkForWinner(code, room);
  });

  // Für Schätzen-Runden: kein Voting, direkte Auswertung nach Nähe zur echten Zahl
  socket.on('revealEstimate', ({ code }) => {
    const room = rooms[code];
    if (!room || room.roundType !== 'estimate') return;

    const prevPositions = {};
    room.players.forEach(p => { prevPositions[p.id] = p.position; });

    const realValue = Number(room.currentQuestionObj.answer);
    const ranked = Object.entries(room.answers)
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
    applyEstimateTriggerCheck(room, prevPositions);
    room.phase = 'reveal';
    broadcastState(code);
    room.catchUpAnnouncement = null; // nur einmalig in der Ansage anzeigen
    checkForWinner(code, room);
  });

  socket.on('showBoard', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.phase = 'board';
    broadcastState(code);
  });

  socket.on('nextRound', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.moderatorIndex = (room.moderatorIndex + 1) % room.players.length;
    room.answers = {};
    room.votes = {};
    room.liveTyping = {};
    room.shuffledAnswers = [];
    room.phase = 'lobby';
    broadcastState(code);
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
    const code = socket.data.roomCode;
    const token = socket.data.token;
    if (!code || !token) return;
    const room = rooms[code];
    if (!room) return;
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
server.listen(PORT, () => console.log(`Bedazzled läuft auf Port ${PORT}`));
