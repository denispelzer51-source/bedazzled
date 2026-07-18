const socket = io();

let myId = null;
let currentCode = null;
let lastState = null;

// ---------- SESSION PERSISTENCE (überlebt Seiten-Reload im selben Tab) ----------
function getOrCreateToken() {
  let token = sessionStorage.getItem('bedazzled_token');
  if (!token) {
    token = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    sessionStorage.setItem('bedazzled_token', token);
  }
  return token;
}
const myToken = getOrCreateToken();

function saveSession(code) {
  sessionStorage.setItem('bedazzled_room', code);
}
function clearSession() {
  sessionStorage.removeItem('bedazzled_room');
}

socket.on('connect', () => {
  const savedCode = sessionStorage.getItem('bedazzled_room');
  if (savedCode) {
    showReconnecting(true);
    socket.emit('rejoinRoom', { code: savedCode, token: myToken });
  }
});

socket.on('rejoinFailed', () => {
  clearSession();
  showReconnecting(false);
});

function showReconnecting(active) {
  const el = document.getElementById('reconnect-banner');
  if (el) el.classList.toggle('hidden', !active);
}

const AVATAR_CHOICES = [
  { emoji: '🦊', label: 'Fuchs' },
  { emoji: '🐢', label: 'Schildkröte' },
  { emoji: '🦄', label: 'Einhorn' },
  { emoji: '🦁', label: 'Löwe' },
  { emoji: '🐼', label: 'Panda' },
  { emoji: '🦉', label: 'Eule' },
];
let selectedAvatar = AVATAR_CHOICES[0].emoji;
let takenAvatars = [];

function avatarFor(player) {
  return (player && player.avatar) || '🦊';
}

const screens = {
  start: document.getElementById('screen-start'),
  lobby: document.getElementById('screen-lobby'),
  answering: document.getElementById('screen-answering'),
  voting: document.getElementById('screen-voting'),
  reveal: document.getElementById('screen-reveal'),
  board: document.getElementById('screen-board'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ---------- AVATAR PICKER ----------
function renderAvatarPicker() {
  const box = document.getElementById('avatar-picker');
  box.innerHTML = '';
  AVATAR_CHOICES.forEach(a => {
    const isTaken = takenAvatars.includes(a.emoji);
    const div = document.createElement('div');
    div.className = 'avatar-option'
      + (a.emoji === selectedAvatar ? ' selected' : '')
      + (isTaken ? ' taken' : '');
    div.innerHTML = `<span class="emoji">${a.emoji}</span><span class="label">${isTaken ? 'vergeben' : a.label}</span>`;
    if (!isTaken) {
      div.addEventListener('click', () => {
        selectedAvatar = a.emoji;
        renderAvatarPicker();
      });
    }
    box.appendChild(div);
  });
}
renderAvatarPicker();

// Prüft live, welche Figuren im eingegebenen Raum schon vergeben sind
let avatarCheckTimeout = null;
document.getElementById('input-code').addEventListener('input', () => {
  clearTimeout(avatarCheckTimeout);
  const code = document.getElementById('input-code').value.trim();
  if (code.length !== 4) {
    takenAvatars = [];
    renderAvatarPicker();
    return;
  }
  avatarCheckTimeout = setTimeout(() => {
    socket.emit('checkTakenAvatars', { code });
  }, 300);
});

socket.on('takenAvatars', ({ takenAvatars: taken }) => {
  takenAvatars = taken || [];
  if (takenAvatars.includes(selectedAvatar)) {
    const free = AVATAR_CHOICES.find(a => !takenAvatars.includes(a.emoji));
    if (free) selectedAvatar = free.emoji;
  }
  renderAvatarPicker();
});

socket.on('avatarTaken', ({ takenAvatars: taken }) => {
  takenAvatars = taken || [];
  const free = AVATAR_CHOICES.find(a => !takenAvatars.includes(a.emoji));
  if (free) selectedAvatar = free.emoji;
  renderAvatarPicker();
  showError('Diese Spielfigur wurde gerade von jemand anderem gewählt. Bitte wähle eine andere.');
});

// ---------- START SCREEN ----------
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  if (!name) return showError('Bitte gib deinen Namen ein.');
  socket.emit('createRoom', { name, avatar: selectedAvatar, token: myToken });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-code').value.trim();
  if (!name) return showError('Bitte gib deinen Namen ein.');
  if (!code) return showError('Bitte gib einen Raum-Code ein.');
  socket.emit('joinRoom', { name, code, avatar: selectedAvatar, token: myToken });
});

function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

socket.on('errorMsg', showError);

socket.on('joined', ({ code, playerId }) => {
  currentCode = code;
  myId = playerId;
  saveSession(code);
  showReconnecting(false);
  document.getElementById('board-bar').classList.remove('hidden');
  showError('');
});

// ---------- LOBBY ----------
document.getElementById('btn-start-round').addEventListener('click', () => {
  socket.emit('startRound', { code: currentCode });
});

// ---------- ANSWERING ----------
let currentRoundType = 'question';

document.getElementById('btn-submit-answer').addEventListener('click', () => {
  if (currentRoundType === 'estimate') {
    const numberInput = document.getElementById('input-answer-number');
    const value = numberInput.value.trim();
    if (value === '') return;
    socket.emit('submitAnswer', { code: currentCode, text: value });
    numberInput.disabled = true;
    document.getElementById('btn-submit-answer').disabled = true;
    document.getElementById('btn-submit-answer').textContent = 'Schätzung abgeschickt ✓';
    return;
  }
  const text = document.getElementById('input-answer').value.trim();
  if (!text) return;
  socket.emit('submitAnswer', { code: currentCode, text });
  document.getElementById('input-answer').disabled = true;
  document.getElementById('btn-submit-answer').disabled = true;
  document.getElementById('btn-submit-answer').textContent = 'Wird geprüft …';
});

socket.on('answerChecking', () => {
  document.getElementById('btn-submit-answer').textContent = 'Wird geprüft …';
});

socket.on('answerRejected', ({ reason }) => {
  const ta = document.getElementById('input-answer');
  ta.disabled = false;
  document.getElementById('btn-submit-answer').disabled = false;
  document.getElementById('btn-submit-answer').textContent = 'Antwort abschicken';
  document.getElementById('answer-reject-msg').textContent = reason;
  document.getElementById('answer-reject-msg').classList.remove('hidden');
  ta.focus();
});

socket.on('answerCorrected', ({ text, wasChanged }) => {
  document.getElementById('input-answer').value = text;
  document.getElementById('answer-reject-msg').classList.add('hidden');
  document.getElementById('btn-submit-answer').textContent = wasChanged
    ? 'Antwort abgeschickt ✓ (automatisch korrigiert)'
    : 'Antwort abgeschickt ✓';
});

// Live-Tippen: Moderator:in sieht in Echtzeit, was gerade eingetippt wird
let typingDebounce = null;
document.getElementById('input-answer').addEventListener('input', (e) => {
  clearTimeout(typingDebounce);
  const text = e.target.value;
  typingDebounce = setTimeout(() => {
    socket.emit('typingAnswer', { code: currentCode, text });
  }, 250);
});

document.getElementById('btn-to-voting').addEventListener('click', () => {
  socket.emit('goToVoting', { code: currentCode });
});

document.getElementById('btn-reveal-estimate').addEventListener('click', () => {
  socket.emit('revealEstimate', { code: currentCode });
});

// ---------- VOTING ----------
let selectedVote = null;
let voteSubmitted = false;

function renderVoteOptions(shuffledAnswers) {
  const box = document.getElementById('vote-options');
  box.innerHTML = '';
  shuffledAnswers.forEach((a, i) => {
    const div = document.createElement('div');
    div.className = 'vote-option';
    div.textContent = a.text;
    div.addEventListener('click', () => {
      if (voteSubmitted) return;
      document.querySelectorAll('.vote-option').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedVote = a.ownerId;
      document.getElementById('btn-submit-vote').disabled = false;
    });
    box.appendChild(div);
  });
}

document.getElementById('btn-submit-vote').addEventListener('click', () => {
  if (!selectedVote || voteSubmitted) return;
  socket.emit('submitVote', { code: currentCode, chosenOwnerId: selectedVote });
  voteSubmitted = true;
  document.getElementById('btn-submit-vote').disabled = true;
  document.getElementById('btn-submit-vote').classList.add('hidden');
  document.getElementById('vote-submitted-msg').classList.remove('hidden');
  document.querySelectorAll('.vote-option').forEach(el => el.style.pointerEvents = 'none');
});

document.getElementById('btn-to-reveal').addEventListener('click', () => {
  socket.emit('revealResults', { code: currentCode });
});

// ---------- REVEAL ----------
document.getElementById('btn-to-board').addEventListener('click', () => {
  socket.emit('showBoard', { code: currentCode });
});

// ---------- BOARD ----------
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

// ---------- BOARD RENDER (mini bar, always visible) ----------
let estimateTriggerFields = [4, 8, 12, 16]; // Standardwert, wird vom Server überschrieben

function renderBoard(players) {
  const track = document.getElementById('board-track');
  const BOARD_LENGTH = 20;
  track.innerHTML = '';
  for (let i = 0; i <= BOARD_LENGTH; i++) {
    const field = document.createElement('div');
    let cls = 'board-field' + (i === BOARD_LENGTH ? ' finish' : '');
    if (estimateTriggerFields.includes(i)) cls += ' estimate-field';
    field.className = cls;
    field.textContent = i === BOARD_LENGTH ? '🏁' : i;
    const here = players.filter(p => p.position === i);
    here.forEach((p, idx) => {
      const tok = document.createElement('span');
      tok.className = 'board-token';
      tok.style.transform = `translate(${idx * 6 - 4}px, ${idx * -6}px)`;
      tok.textContent = avatarFor(p);
      tok.title = p.name;
      field.appendChild(tok);
    });
    track.appendChild(field);
  }
}

// ---------- BOARD RENDER (large, animated, rechteckige Laufbahn) ----------
const BOARD_LENGTH = 20;
const BOARD_SLOTS = BOARD_LENGTH + 1; // Felder 0..20
const HOP_MS = 380; // Dauer pro Feld-Hop bei der Animation
let roundStartPositions = {};

// Verteilt Feld i gleichmäßig entlang des Umfangs eines Rechtecks (Seitenverhältnis 2:1),
// sodass die Abstände zwischen Feldern optisch gleich groß wirken.
function fieldPercent(i, totalSlots) {
  const W = 2, H = 1; // Verhältnis Breite:Höhe des Rechtecks
  const P = 2 * W + 2 * H;
  let d = (i / totalSlots) * P;
  if (d <= W) return { x: (d / W) * 100, y: 0 };                       // obere Kante, links -> rechts
  d -= W;
  if (d <= H) return { x: 100, y: (d / H) * 100 };                     // rechte Kante, oben -> unten
  d -= H;
  if (d <= W) return { x: 100 - (d / W) * 100, y: 100 };               // untere Kante, rechts -> links
  d -= W;
  return { x: 0, y: 100 - (d / H) * 100 };                             // linke Kante, unten -> oben
}

function renderBoardLarge(players, fromPositions, animate) {
  const fieldsBox = document.getElementById('board-fields-large');
  const tokensBox = document.getElementById('board-tokens-large');
  fieldsBox.innerHTML = '';
  for (let i = 0; i < BOARD_SLOTS; i++) {
    const pos = fieldPercent(i, BOARD_SLOTS);
    const dot = document.createElement('div');
    let dotCls = 'board-field-dot' + (i === BOARD_LENGTH ? ' finish' : '');
    if (estimateTriggerFields.includes(i)) dotCls += ' estimate-field';
    dot.className = dotCls;
    dot.style.left = pos.x + '%';
    dot.style.top = pos.y + '%';
    dot.textContent = i === BOARD_LENGTH ? '🏁' : i;
    fieldsBox.appendChild(dot);
  }

  tokensBox.innerHTML = '';
  const tokenEls = {};
  players.forEach((p, idx) => {
    const tok = document.createElement('span');
    tok.className = 'board-token-rect';
    tok.textContent = avatarFor(p);
    tok.title = p.name;
    const startPos = animate ? (fromPositions[p.id] ?? p.position) : p.position;
    const pos = fieldPercent(startPos, BOARD_SLOTS);
    tok.style.left = pos.x + '%';
    tok.style.top = pos.y + '%';
    // leichter Versatz, falls mehrere Figuren auf demselben Feld stehen
    tok.style.transform = `translate(${(idx % 3) * 9 - 9}px, ${Math.floor(idx / 3) * 9 - 9}px)`;
    tokensBox.appendChild(tok);
    tokenEls[p.id] = tok;
  });

  if (animate) {
    players.forEach(p => {
      const start = fromPositions[p.id] ?? p.position;
      const steps = p.position - start;
      if (steps <= 0) return;
      for (let s = 1; s <= steps; s++) {
        setTimeout(() => {
          const tok = tokenEls[p.id];
          if (!tok) return;
          const pos = fieldPercent(start + s, BOARD_SLOTS);
          tok.style.left = pos.x + '%';
          tok.style.top = pos.y + '%';
        }, s * HOP_MS);
      }
    });
  }

  const legend = document.getElementById('board-legend');
  legend.innerHTML = '';
  players.forEach(p => {
    const span = document.createElement('span');
    span.textContent = `${avatarFor(p)} ${p.name}: Feld ${p.position}`;
    legend.appendChild(span);
  });
}

// ---------- MAIN STATE HANDLER ----------
socket.on('state', (state) => {
  const enteringVoting = state.phase === 'voting' && (!lastState || lastState.phase !== 'voting');
  if (enteringVoting) {
    selectedVote = null;
    voteSubmitted = false;
  }
  const enteringAnswering = state.phase === 'answering' && (!lastState || lastState.phase !== 'answering');
  const enteringBoard = state.phase === 'board' && (!lastState || lastState.phase !== 'board');
  if (enteringAnswering) {
    roundStartPositions = {};
    state.players.forEach(p => { roundStartPositions[p.id] = p.position; });
    const ta = document.getElementById('input-answer');
    const num = document.getElementById('input-answer-number');
    ta.value = ''; ta.disabled = false;
    num.value = ''; num.disabled = false;
    document.getElementById('btn-submit-answer').disabled = false;
    document.getElementById('btn-submit-answer').textContent = 'Antwort abschicken';
    document.getElementById('answer-reject-msg').classList.add('hidden');
  }

  lastState = state;
  if (state.estimateTriggerFields) estimateTriggerFields = state.estimateTriggerFields;
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
      li.className = p.connected === false ? 'disconnected' : '';
      li.innerHTML = `<span>${avatarFor(p)} ${p.name}${p.id === myId ? ' (du)' : ''}${p.connected === false ? '<span class="tag-offline">getrennt</span>' : ''}</span>`;
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

  if (state.phase === 'answering') {
    currentRoundType = state.roundType || 'question';
    const isEstimate = currentRoundType === 'estimate';
    document.getElementById('answering-phase-tag').textContent = isEstimate ? 'Schätz-Frage 🔢' : 'Antwort-Phase';
    document.getElementById('question-text-2').textContent = state.currentQuestion || '';
    document.getElementById('answered-count').textContent = state.answeredCount;
    document.getElementById('answering-total').textContent = Math.max(state.players.length - 1, 0);
    document.getElementById('answer-input-label').textContent = isEstimate
      ? 'Wie lautet deine Schätzung?'
      : 'Denk dir eine überzeugende, falsche Antwort aus:';
    document.getElementById('input-answer').classList.toggle('hidden', isEstimate);
    document.getElementById('input-answer-number').classList.toggle('hidden', !isEstimate);
    document.getElementById('btn-to-voting').classList.toggle('hidden', isEstimate);
    document.getElementById('btn-reveal-estimate').classList.toggle('hidden', !isEstimate);

    if (iAmModerator) {
      document.getElementById('answer-input-box').classList.add('hidden');
      document.getElementById('moderator-wait-box').classList.remove('hidden');
      document.getElementById('real-answer-box').classList.remove('hidden');
      document.getElementById('real-answer-box').textContent = (isEstimate ? 'Echte Zahl (nur für dich): ' : 'Echte Antwort (nur für dich): ') + (state.realAnswer ?? '');
      const previewBox = document.getElementById('moderator-answers-preview');
      previewBox.classList.remove('hidden');
      previewBox.innerHTML = '';
      (state.answersPreview || []).forEach(a => {
        const div = document.createElement('div');
        div.className = 'reveal-item' + (a.submitted ? '' : ' typing-preview');
        const statusTag = a.submitted
          ? ''
          : `<span class="typing-tag">${a.text ? 'tippt gerade …' : 'noch nichts eingegeben'}</span>`;
        const shownText = a.text ? escapeHtml(String(a.text)) : '<span class="placeholder-text">…</span>';
        div.innerHTML = `${shownText}${statusTag}<span class="owner">${escapeHtml(a.name)}</span>`;
        previewBox.appendChild(div);
      });
    } else {
      document.getElementById('answer-input-box').classList.remove('hidden');
      document.getElementById('moderator-wait-box').classList.add('hidden');
      document.getElementById('real-answer-box').classList.add('hidden');
      document.getElementById('moderator-answers-preview').classList.add('hidden');
    }
    showScreen('answering');
  }

  if (state.phase === 'voting') {
    document.getElementById('question-text-3').textContent = state.currentQuestion || '';
    document.getElementById('voted-count').textContent = state.votedCount;
    document.getElementById('voting-total').textContent = Math.max(state.players.length - 1, 0);
    if (iAmModerator) {
      document.getElementById('vote-options').classList.add('hidden');
      document.getElementById('btn-submit-vote').classList.add('hidden');
      document.getElementById('moderator-vote-wait').classList.remove('hidden');
    } else {
      document.getElementById('moderator-vote-wait').classList.add('hidden');
      if (enteringVoting) {
        document.getElementById('vote-options').classList.remove('hidden');
        document.getElementById('btn-submit-vote').classList.remove('hidden');
        document.getElementById('btn-submit-vote').disabled = true;
        document.getElementById('vote-submitted-msg').classList.add('hidden');
        renderVoteOptions(state.shuffledAnswers);
      }
    }
    showScreen('voting');
  }

  if (state.phase === 'reveal') {
    document.getElementById('question-text-4').textContent = state.currentQuestion || '';
    const list = document.getElementById('reveal-list');
    const realBox = document.getElementById('estimate-real-answer');
    list.innerHTML = '';

    if (state.roundType === 'estimate') {
      realBox.classList.remove('hidden');
      realBox.textContent = 'Echte Zahl: ' + state.estimateRealAnswer;
      const medals = ['🥇', '🥈', '🥉'];
      (state.estimateResults || []).forEach(r => {
        const div = document.createElement('div');
        div.className = 'reveal-item' + (r.points > 0 ? ' real' : '');
        const medal = medals[r.rank - 1] || `${r.rank}.`;
        const pointsText = r.points > 0 ? `+${r.points} Punkte` : 'keine Punkte';
        div.innerHTML = `${medal} ${escapeHtml(r.name)}: <strong>${r.value}</strong><span class="owner">${pointsText}</span>`;
        list.appendChild(div);
      });
    } else {
      realBox.classList.add('hidden');
      state.shuffledAnswers.forEach(a => {
        const div = document.createElement('div');
        const isMyVote = state.myVote === a.ownerId;
        let cls = 'reveal-item' + (a.isReal ? ' real' : '');
        if (isMyVote) cls += a.isReal ? ' my-correct' : ' my-wrong';
        div.className = cls;
        const ownerName = a.isReal ? 'Echte Antwort ✔' : (state.players.find(p => p.id === a.ownerId)?.name || '???');
        const badge = isMyVote ? `<span class="my-vote-badge">${a.isReal ? '✔ Richtig getippt!' : '✗ Reingefallen'}</span>` : '';
        div.innerHTML = `${escapeHtml(a.text)}<span class="owner">${ownerName}</span>${badge}`;
        list.appendChild(div);
      });
    }
    showScreen('reveal');
  }

  if (state.phase === 'board') {
    renderBoardLarge(state.players, roundStartPositions, enteringBoard);
    showScreen('board');
  }
});

