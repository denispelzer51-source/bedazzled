const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const QUESTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
const BOARD_LENGTH = 20; // Zielfeld
const POINTS_CORRECT_GUESS = 2;
const POINTS_PER_FOOLED_PLAYER = 3;

/** rooms: { code: { players: [{id,name,position,socketId}], moderatorIndex, phase,
 *   questionIndex, usedQuestions:[], answers: {playerId: text}, votes: {playerId: chosenAnswerOwnerId},
 *   shuffledAnswers: [{ownerId, text, isReal}] } }
 */
const rooms = {};

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
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, position: p.position })),
    moderatorId,
    currentQuestion: room.phase !== 'lobby' && room.currentQuestionObj ? room.currentQuestionObj.question : null,
    realAnswer: (isModerator && room.phase === 'question' && room.currentQuestionObj) ? room.currentQuestionObj.answer : null,
    answeredCount: Object.keys(room.answers || {}).length,
    votedCount: Object.keys(room.votes || {}).length,
    shuffledAnswers: room.phase === 'voting' || room.phase === 'reveal'
      ? room.shuffledAnswers.map(a => room.phase === 'reveal' ? a : { text: a.text, ownerId: a.ownerId })
      : [],
  };
}

function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.players.forEach(p => {
    io.to(p.socketId).emit('state', publicRoomState(room, p.id));
  });
}

function pickNextQuestion(room) {
  const available = QUESTIONS.map((q, i) => i).filter(i => !room.usedQuestions.includes(i));
  const pool = available.length > 0 ? available : QUESTIONS.map((q, i) => i);
  if (available.length === 0) room.usedQuestions = [];
  const idx = pool[Math.floor(Math.random() * pool.length)];
  room.usedQuestions.push(idx);
  return { index: idx, ...QUESTIONS[idx] };
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, avatar }) => {
    const code = genRoomCode();
    const player = { id: socket.id, name: name || 'Spieler', avatar: avatar || '🦊', position: 0, socketId: socket.id };
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
    };
    socket.join(code);
    socket.emit('joined', { code, playerId: socket.id });
    broadcastState(code);
  });

  socket.on('joinRoom', ({ name, code, avatar }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('errorMsg', 'Raum nicht gefunden. Prüfe den Code.');
      return;
    }
    if (room.phase !== 'lobby') {
      socket.emit('errorMsg', 'Spiel läuft schon. Bitte warte auf die nächste Runde.');
      return;
    }
    room.players.push({ id: socket.id, name: name || 'Spieler', avatar: avatar || '🦊', position: 0, socketId: socket.id });
    socket.join(code);
    socket.emit('joined', { code, playerId: socket.id });
    broadcastState(code);
  });

  socket.on('startRound', ({ code }) => {
    const room = rooms[code];
    if (!room || room.players.length < 3) {
      socket.emit('errorMsg', 'Mindestens 3 Spieler nötig, um zu starten.');
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
    const moderatorId = room.players[room.moderatorIndex].id;
    if (socket.id === moderatorId) return; // Moderator gibt keine Antwort ab
    room.answers[socket.id] = (text || '').trim().slice(0, 140);
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
    const moderatorId = room.players[room.moderatorIndex].id;
    if (socket.id === moderatorId) return; // Moderator stimmt nicht ab
    room.votes[socket.id] = chosenOwnerId;
    broadcastState(code);
  });

  socket.on('revealResults', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const moderatorId = room.players[room.moderatorIndex].id;

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
    for (const code of Object.keys(rooms)) {
      const room = rooms[code];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          delete rooms[code];
        } else {
          if (room.moderatorIndex >= room.players.length) room.moderatorIndex = 0;
          broadcastState(code);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Bedazzled läuft auf Port ${PORT}`));
