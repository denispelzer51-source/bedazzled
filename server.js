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
const BOARD_LENGTH = 20; // Zielfeld
const POINTS_CORRECT_GUESS = 3;
const POINTS_PER_FOOLED_PLAYER = 2;
const DISCONNECT_GRACE_MS = 3 * 60 * 1000; // 3 Minuten, bevor ein getrennter Spieler endgültig entfernt wird

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

// ---------- Fragen-Verwaltung (Admin-API) ----------
app.get('/api/questions', checkAdmin, (req, res) => {
  res.json(questionsList);
});

app.post('/api/questions', checkAdmin, (req, res) => {
  const { question, answer } = req.body || {};
  if (!question || !answer) {
    res.status(400).json({ error: 'Frage und Antwort sind erforderlich.' });
    return;
  }
  questionsList.push({ question: question.trim(), answer: answer.trim() });
  saveQuestions();
  res.json(questionsList);
});

app.put('/api/questions/:index', checkAdmin, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (!questionsList[idx]) {
    res.status(404).json({ error: 'Frage nicht gefunden.' });
    return;
  }
  const { question, answer } = req.body || {};
  if (question) questionsList[idx].question = question.trim();
  if (answer) questionsList[idx].answer = answer.trim();
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
    .map(i => ({ question: String(i.question).trim(), answer: String(i.answer).trim() }));
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

const AVATAR_SET = ['🦊', '🐢', '🦄', '🦁', '🐼', '🦉'];

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
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, position: p.position, connected: !!p.socketId })),
    moderatorId,
    currentQuestion: room.phase !== 'lobby' && room.currentQuestionObj ? room.currentQuestionObj.question : null,
    realAnswer: (isModerator && room.phase === 'question' && room.currentQuestionObj) ? room.currentQuestionObj.answer : null,
    answeredCount: Object.keys(room.answers || {}).length,
    votedCount: Object.keys(room.votes || {}).length,
    // Der/die Moderator:in sieht schon während der Antwort-Phase, wer was geschrieben hat
    answersPreview: (isModerator && room.phase === 'answering')
      ? Object.entries(room.answers).map(([pid, text]) => {
          const author = room.players.find(pp => pp.id === pid);
          return { name: author ? author.name : '???', text };
        })
      : [],
    // Damit jede:r sofort sieht, ob die eigene Wahl in der Abstimmung richtig war
    myVote: room.votes[forPlayerId] || null,
    shuffledAnswers: room.phase === 'voting' || room.phase === 'reveal'
      ? room.shuffledAnswers.map(a => room.phase === 'reveal' ? a : { text: a.text, ownerId: a.ownerId })
      : [],
  };
}

function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.players.forEach(p => {
    if (p.socketId) io.to(p.socketId).emit('state', publicRoomState(room, p.id));
  });
}

function pickNextQuestion(room) {
  const available = questionsList.map((q, i) => i).filter(i => !room.usedQuestions.includes(i));
  const pool = available.length > 0 ? available : questionsList.map((q, i) => i);
  if (available.length === 0) room.usedQuestions = [];
  const idx = pool[Math.floor(Math.random() * pool.length)];
  room.usedQuestions.push(idx);
  return { index: idx, ...questionsList[idx] };
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
  broadcastState(roomCode);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, avatar, token }) => {
    const code = genRoomCode();
    const playerId = token || crypto.randomUUID();
    socket.data.token = playerId;
    socket.data.roomCode = code;
    const player = { id: playerId, name: name || 'Spieler', avatar: avatar || '🦊', position: 0, socketId: socket.id };
    rooms[code] = {
      code,
      players: [player],
      moderatorIndex: 0,
      phase: 'lobby',
      usedQuestions: [],
      answers: {},
      votes: {},
      shuffledAnswers: [],
      currentQuestionObj: null,
      removalTimers: {},
    };
    socket.join(code);
    socket.emit('joined', { code, playerId });
    broadcastState(code);
  });

  socket.on('joinRoom', ({ name, code, avatar, token }) => {
    const room = rooms[code];
    if (!room) {
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
    room.players.push({ id: playerId, name: name || 'Spieler', avatar: avatar || '🦊', position: 0, socketId: socket.id });
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
    if (questionsList.length === 0) {
      socket.emit('errorMsg', 'Es sind keine Fragen hinterlegt. Bitte über /admin.html Fragen hinzufügen.');
      return;
    }
    room.phase = 'question';
    room.answers = {};
    room.votes = {};
    room.shuffledAnswers = [];
    room.currentQuestionObj = pickNextQuestion(room);
    broadcastState(code);
  });

  socket.on('goToAnswering', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.phase = 'answering';
    broadcastState(code);
  });

  socket.on('submitAnswer', ({ code, text }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'answering') return;
    const myId = socket.data.token;
    const moderatorId = room.players[room.moderatorIndex].id;
    if (myId === moderatorId) return; // Moderator gibt keine Antwort ab
    room.answers[myId] = (text || '').trim().slice(0, 140);
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
    room.phase = 'voting';
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
    if (!room) return;

    // Punkte berechnen
    for (const [voterId, chosenOwnerId] of Object.entries(room.votes)) {
      if (chosenOwnerId === 'REAL') {
        const player = room.players.find(p => p.id === voterId);
        if (player) player.position = Math.min(BOARD_LENGTH, player.position + POINTS_CORRECT_GUESS);
      } else {
        const fooledOwner = room.players.find(p => p.id === chosenOwnerId);
        if (fooledOwner && fooledOwner.id !== voterId) {
          fooledOwner.position = Math.min(BOARD_LENGTH, fooledOwner.position + POINTS_PER_FOOLED_PLAYER);
        }
      }
    }

    room.phase = 'reveal';
    broadcastState(code);

    const winner = room.players.find(p => p.position >= BOARD_LENGTH);
    if (winner) {
      io.to(code).emit('gameOver', { winnerName: winner.name });
    }
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
    room.shuffledAnswers = [];
    room.phase = 'lobby';
    broadcastState(code);
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
