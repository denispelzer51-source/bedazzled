const socket = io();

let myId = null;
let currentCode = null;
let lastState = null;

const AVATARS = ['🦊', '🐸', '🦉', '🐙', '🦁', '🐼', '🦄', '🐢', '🦋', '🐳'];
function avatarFor(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 1000;
  return AVATARS[hash % AVATARS.length];
}

const screens = {
  start: document.getElementById('screen-start'),
  lobby: document.getElementById('screen-lobby'),
  question: document.getElementById('screen-question'),
  answering: document.getElementById('screen-answering'),
  voting: document.getElementById('screen-voting'),
  reveal: document.getElementById('screen-reveal'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ---------- START SCREEN ----------
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  if (!name) return showError('Bitte gib deinen Namen ein.');
  socket.emit('createRoom', { name });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-code').value.trim();
  if (!name) return showError('Bitte gib deinen Namen ein.');
  if (!code) return showError('Bitte gib einen Raum-Code ein.');
  socket.emit('joinRoom', { name, code });
});

function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
}

socket.on('errorMsg', showError);

socket.on('joined', ({ code, playerId }) => {
  currentCode = code;
  myId = playerId;
  document.getElementById('board-bar').classList.remove('hidden');
  showError('');
});

// ---------- LOBBY ----------
document.getElementById('btn-start-round').addEventListener('click', () => {
  socket.emit('startRound', { code: currentCode });
});

// ---------- QUESTION ----------
document.getElementById('btn-to-answering').addEventListener('click', () => {
  socket.emit('goToAnswering', { code: currentCode });
});

// ---------- ANSWERING ----------
document.getElementById('btn-submit-answer').addEventListener('click', () => {
  const text = document.getElementById('input-answer').value.trim();
  if (!text) return;
  socket.emit('submitAnswer', { code: currentCode, text });
  document.getElementById('input-answer').disabled = true;
  document.getElementById('btn-submit-answer').disabled = true;
  document.getElementById('btn-submit-answer').textContent = 'Antwort abgeschickt ✓';
});

document.getElementById('btn-to-voting').addEventListener('click', () => {
  socket.emit('goToVoting', { code: currentCode });
});

// ---------- VOTING ----------
let selectedVote = null;
function renderVoteOptions(shuffledAnswers) {
  const box = document.getElementById('vote-options');
  box.innerHTML = '';
  shuffledAnswers.forEach((a, i) => {
    const div = document.createElement('div');
    div.className = 'vote-option';
    div.textContent = a.text;
    div.addEventListener('click', () => {
      document.querySelectorAll('.vote-option').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedVote = a.ownerId;
      socket.emit('submitVote', { code: currentCode, chosenOwnerId: a.ownerId });
    });
    box.appendChild(div);
  });
}

document.getElementById('btn-to-reveal').addEventListener('click', () => {
  socket.emit('revealResults', { code: currentCode });
});

// ---------- REVEAL ----------
document.getElementById('btn-next-round').addEventListener('click', () => {
  socket.emit('nextRound', { code: currentCode });
});

// ---------- WINNER OVERLAY ----------
socket.on('gameOver', ({ winnerName }) => {
  document.getElementById('winner-text').textContent = `${winnerName} hat gewonnen! 🎉`;
  document.getElementById('winner-overlay').classList.remove('hidden');
});
document.getElementById('btn-close-winner').addEventListener('click', () => {
  document.getElementById('winner-overlay').classList.add('hidden');
});

// ---------- BOARD RENDER ----------
function renderBoard(players) {
  const track = document.getElementById('board-track');
  const BOARD_LENGTH = 20;
  track.innerHTML = '';
  for (let i = 0; i <= BOARD_LENGTH; i++) {
    const field = document.createElement('div');
    field.className = 'board-field' + (i === BOARD_LENGTH ? ' finish' : '');
    const here = players.filter(p => p.position === i);
    here.forEach((p, idx) => {
      const tok = document.createElement('span');
      tok.className = 'board-token';
      tok.style.transform = `translate(${idx * 6 - 4}px, ${idx * -6}px)`;
      tok.textContent = avatarFor(p.id);
      tok.title = p.name;
      field.appendChild(tok);
    });
    track.appendChild(field);
  }
}

// ---------- MAIN STATE HANDLER ----------
socket.on('state', (state) => {
  lastState = state;
  const iAmModerator = state.moderatorId === myId;

  renderBoard(state.players);

  document.querySelectorAll('.mod-only').forEach(el => el.style.display = iAmModerator ? 'block' : 'none');
  document.querySelectorAll('.mod-hide').forEach(el => el.style.display = iAmModerator ? 'none' : 'block');

  if (state.phase === 'lobby') {
    document.getElementById('room-code-display').textContent = state.code;
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    state.players.forEach(p => {
      const li = document.createElement('li');
      const isMod = p.id === state.moderatorId;
      li.innerHTML = `<span>${avatarFor(p.id)} ${p.name}${p.id === myId ? ' (du)' : ''}</span>`;
      if (isMod) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'Moderator';
        li.appendChild(tag);
      }
      list.appendChild(li);
    });
    document.getElementById('btn-start-round').style.display = state.players.length >= 3 ? 'block' : 'none';
    showScreen('lobby');
  }

  if (state.phase === 'question') {
    document.getElementById('question-text').textContent = state.currentQuestion || '';
    if (iAmModerator) {
      document.getElementById('moderator-banner').textContent = 'Du bist Moderator:in – lies die Frage laut vor!';
      document.getElementById('real-answer-box').classList.remove('hidden');
      document.getElementById('real-answer-box').textContent = 'Echte Antwort (nur für dich): ' + (state.realAnswer || '');
    } else {
      document.getElementById('moderator-banner').textContent = '';
      document.getElementById('real-answer-box').classList.add('hidden');
    }
    showScreen('question');
  }

  if (state.phase === 'answering') {
    document.getElementById('question-text-2').textContent = state.currentQuestion || '';
    document.getElementById('answered-count').textContent = state.answeredCount;
    document.getElementById('answering-total').textContent = Math.max(state.players.length - 1, 0);
    if (iAmModerator) {
      document.getElementById('answer-input-box').classList.add('hidden');
      document.getElementById('moderator-wait-box').classList.remove('hidden');
    } else {
      document.getElementById('answer-input-box').classList.remove('hidden');
      document.getElementById('moderator-wait-box').classList.add('hidden');
    }
    showScreen('answering');
  }

  if (state.phase === 'voting') {
    document.getElementById('question-text-3').textContent = state.currentQuestion || '';
    document.getElementById('voted-count').textContent = state.votedCount;
    document.getElementById('voting-total').textContent = Math.max(state.players.length - 1, 0);
    if (iAmModerator) {
      document.getElementById('vote-options').classList.add('hidden');
      document.getElementById('moderator-vote-wait').classList.remove('hidden');
    } else {
      document.getElementById('vote-options').classList.remove('hidden');
      document.getElementById('moderator-vote-wait').classList.add('hidden');
      renderVoteOptions(state.shuffledAnswers);
    }
    showScreen('voting');
  }

  if (state.phase === 'reveal') {
    document.getElementById('question-text-4').textContent = state.currentQuestion || '';
    const list = document.getElementById('reveal-list');
    list.innerHTML = '';
    state.shuffledAnswers.forEach(a => {
      const div = document.createElement('div');
      div.className = 'reveal-item' + (a.isReal ? ' real' : '');
      const ownerName = a.isReal ? 'Echte Antwort ✔' : (state.players.find(p => p.id === a.ownerId)?.name || '???');
      div.innerHTML = `${a.text}<span class="owner">${ownerName}</span>`;
      list.appendChild(div);
    });
    showScreen('reveal');
  }
});

