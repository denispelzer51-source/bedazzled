const socket = io({ timeout: 45000, reconnectionAttempts: 15 });

let connectionTroubleShown = false;
socket.on('connect_error', () => {
  if (connectionTroubleShown) return;
  connectionTroubleShown = true;
  showError('Verbindung dauert länger als erwartet (der Server "wacht" evtl. gerade erst auf, das kann bis zu 50 Sekunden dauern). Falls du den Link direkt aus WhatsApp geöffnet hast: tippe oben rechts auf "..." und wähle "Im Browser öffnen" – der eingebaute WhatsApp-Browser blockiert manchmal die Verbindung, besonders auf iPhones.');
});

// ---------- SOUNDEFFEKTE (dezent, per Web Audio erzeugt, keine externen Dateien nötig) ----------
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function beep(freq, duration, volume, type) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* Audio nicht verfügbar, einfach stumm weitermachen */ }
}
function playSubmitSound() { beep(600, 0.1, 0.06, 'sine'); }
function playRevealSound() {
  beep(500, 0.14, 0.06, 'sine');
  setTimeout(() => beep(760, 0.16, 0.06, 'sine'), 90);
}
function playHopSound() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;

    // Kurzer, gefilterter Rauschimpuls simuliert das "Tock" einer Spielfigur, die auf ein
    // Brett gesetzt wird - klingt organischer als ein reiner Sinus-/Rechteck-Ton.
    const bufferSize = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // abklingendes Rauschen
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;

    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);

    // Ein kurzer, tiefer "Klopf"-Ton darunter für mehr Körper im Klang
    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(180, now);
    thud.frequency.exponentialRampToValueAtTime(90, now + 0.05);
    thudGain.gain.value = 0.05;
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    thud.connect(thudGain);
    thudGain.connect(ctx.destination);
    thud.start(now);
    thud.stop(now + 0.08);
  } catch (e) { /* Audio nicht verfügbar, einfach stumm weitermachen */ }
}
function playWinSound() {
  [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, 0.22, 0.07, 'triangle'), i * 110));
}

// ---------- DARK/LIGHT THEME ----------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-toggle').textContent = theme === 'light' ? '☀️' : '🌙';
  localStorage.setItem('bedazzled_theme', theme);
}
const savedTheme = localStorage.getItem('bedazzled_theme') || 'dark';
applyTheme(savedTheme);
document.getElementById('theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'light' ? 'dark' : 'light');
});

let myId = null;
let currentCode = null;
let lastState = null;

// ---------- SESSION PERSISTENCE (überlebt Seiten-Reload im selben Tab) ----------
// Für den Multiplayer-Simulator (/simulator.html) laufen mehrere Spieler-Instanzen als
// iframes auf derselben Seite. iframes vom selben Ursprung teilen sich sessionStorage,
// deshalb bekommt jede Instanz über ?testSlot=N ihren eigenen, getrennten Storage-Schlüssel.
const urlParams = new URLSearchParams(window.location.search);
const testSlot = urlParams.get('testSlot');
const roomFromLink = urlParams.get('room');
const TOKEN_KEY = testSlot ? `bedazzled_token_slot${testSlot}` : 'bedazzled_token';
const ROOM_KEY = testSlot ? `bedazzled_room_slot${testSlot}` : 'bedazzled_room';

function getOrCreateToken() {
  let token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    sessionStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}
let myToken = getOrCreateToken();

function saveSession(code) {
  sessionStorage.setItem(ROOM_KEY, code);
}
function clearSession() {
  sessionStorage.removeItem(ROOM_KEY);
}

socket.on('connect', () => {
  connectionTroubleShown = false;
  showError('');
  const savedCode = sessionStorage.getItem(ROOM_KEY);
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
  { emoji: '💎', label: 'Diamant' },
  { emoji: '🎭', label: 'Maske' },
  { emoji: '🔮', label: 'Kristallkugel' },
  { emoji: '🃏', label: 'Joker' },
  { emoji: '👑', label: 'Krone' },
  { emoji: '⭐', label: 'Stern' },
];
let selectedAvatar = AVATAR_CHOICES[0].emoji;
let takenAvatars = [];

function avatarFor(player) {
  return (player && player.avatar) || '💎';
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
  updateBoardBarHeightVar();
}

// Die untere Spielleiste ist unterschiedlich hoch (abhängig vom Gerät/Safe-Area) - die
// tatsächlich gerenderte Höhe wird gemessen, damit der fest angeheftete Button-Fußbereich
// immer exakt darüber sitzt, statt einen geschätzten Fixwert zu verwenden
function updateBoardBarHeightVar() {
  const bar = document.getElementById('board-bar');
  const height = (bar && !bar.classList.contains('hidden')) ? bar.offsetHeight : 0;
  document.documentElement.style.setProperty('--board-bar-height', height + 'px');
}
window.addEventListener('resize', updateBoardBarHeightVar);
window.addEventListener('orientationchange', () => setTimeout(updateBoardBarHeightVar, 200));

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

// Simulator-Komfort: Name + Spielfigur automatisch vorausfüllen, wenn als Test-Slot geöffnet
if (testSlot) {
  document.getElementById('input-name').value = 'Tester ' + testSlot;
  const slotIndex = (parseInt(testSlot, 10) - 1) % AVATAR_CHOICES.length;
  selectedAvatar = AVATAR_CHOICES[slotIndex] ? AVATAR_CHOICES[slotIndex].emoji : selectedAvatar;
  renderAvatarPicker();
}

// Komfort: Wenn der Link mit einem Raum-Code geöffnet wurde (z.B. per WhatsApp geteilt),
// Code direkt vorausfüllen, damit nur noch der Name eingetippt werden muss
if (roomFromLink && /^\d{4}$/.test(roomFromLink)) {
  document.getElementById('input-code').value = roomFromLink;
  document.getElementById('input-name').focus();
  socket.emit('checkTakenAvatars', { code: roomFromLink });
}

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
  myToken = playerId;
  sessionStorage.setItem(TOKEN_KEY, playerId);
  saveSession(code);
  showReconnecting(false);
  document.getElementById('board-bar').classList.remove('hidden');
  showError('');
});

// Jemand versucht mitten im Spiel beizutreten und der Name passt zu einem getrennten
// Spieler - fragen, ob er/sie das ist und den alten Platz (Position, Punkte, Rolle) übernehmen möchte
socket.on('reclaimAvailable', ({ code, existingPlayerId, existingName }) => {
  const wantsReclaim = confirm(`Es gibt schon einen getrennten Spieler namens "${existingName}" in diesem Raum. Bist du das und möchtest du an der gleichen Stelle weitermachen (mit deiner bisherigen Position und deinen Punkten)?`);
  if (wantsReclaim) {
    socket.emit('confirmReclaim', { code, existingPlayerId });
  } else {
    showError('Bitte wähle einen anderen Namen, um als neuer Spieler beizutreten (sofern das Spiel das noch zulässt).');
  }
});

// ---------- LOBBY ----------
document.getElementById('btn-start-round').addEventListener('click', () => {
  socket.emit('startRound', { code: currentCode });
});

document.getElementById('btn-leave-room').addEventListener('click', () => {
  if (currentCode) socket.emit('leaveRoom', { code: currentCode });
  clearSession();
  currentCode = null;
  myId = null;
  lastState = null;
  document.getElementById('board-bar').classList.add('hidden');
  document.getElementById('input-code').value = '';
  showError('');
  showScreen('start');
});

document.getElementById('btn-copy-link').addEventListener('click', async () => {
  const link = `${window.location.origin}/?room=${currentCode}`;
  try {
    await navigator.clipboard.writeText(link);
  } catch (e) {
    // Fallback für Browser ohne Clipboard-API-Berechtigung
    const tempInput = document.createElement('input');
    tempInput.value = link;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
  }
  const msg = document.getElementById('copy-link-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2500);
});

document.getElementById('btn-share-whatsapp').addEventListener('click', () => {
  const link = `${window.location.origin}/?room=${currentCode}`;
  const text = `Spiel mit bei Bedazzled! 🎭\n${link}`;
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
});

// ---------- ANSWERING ----------
let currentRoundType = 'question';

document.getElementById('btn-submit-answer').addEventListener('click', () => {
  if (currentRoundType === 'estimate') {
    const numberInput = document.getElementById('input-answer-number');
    const value = numberInput.value.trim();
    if (value === '') return;
    socket.emit('submitAnswer', { code: currentCode, text: value });
    document.getElementById('btn-submit-answer').textContent = 'Schätzung abgeschickt ✓ (Änderung möglich)';
    playSubmitSound();
    return;
  }
  const text = document.getElementById('input-answer').value.trim();
  if (!text) return;
  socket.emit('submitAnswer', { code: currentCode, text });
  document.getElementById('input-answer').disabled = true;
  document.getElementById('btn-submit-answer').disabled = true;
  document.getElementById('btn-submit-answer').textContent = 'Wird geprüft …';
  playSubmitSound();
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

socket.on('answerLocked', ({ reason }) => {
  document.getElementById('input-answer').disabled = true;
  document.getElementById('input-answer-number').disabled = true;
  document.getElementById('btn-submit-answer').disabled = true;
  document.getElementById('btn-submit-answer').textContent = 'Alle fertig – keine Änderung mehr möglich';
  document.getElementById('answer-reject-msg').textContent = reason;
  document.getElementById('answer-reject-msg').classList.remove('hidden');
});

socket.on('answerCorrected', ({ text, wasChanged }) => {
  document.getElementById('input-answer').value = text;
  document.getElementById('input-answer').disabled = false; // Änderung bleibt möglich, solange nicht alle fertig sind
  document.getElementById('btn-submit-answer').disabled = false;
  document.getElementById('answer-reject-msg').classList.add('hidden');
  document.getElementById('btn-submit-answer').textContent = 'Antwort abgeschickt ✓ (Änderung möglich)';
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
document.getElementById('input-answer-number').addEventListener('input', (e) => {
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
    div.dataset.ownerId = a.ownerId;
    div.addEventListener('click', () => {
      if (voteSubmitted) return;
      document.querySelectorAll('.vote-option').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedVote = a.ownerId;
      document.getElementById('btn-submit-vote').disabled = false;
      socket.emit('previewVote', { code: currentCode, chosenOwnerId: a.ownerId });
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
  playSubmitSound();
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
socket.on('gameOver', ({ winnerName, awards }) => {
  document.getElementById('winner-text').textContent = `${winnerName} hat gewonnen! 🎉`;
  const awardsBox = document.getElementById('awards-list');
  awardsBox.innerHTML = '';
  (awards || []).forEach(a => {
    const div = document.createElement('div');
    div.className = 'award-item';
    div.innerHTML = `<span class="award-title">${escapeHtml(a.title)}</span><span class="award-names">${a.names.map(escapeHtml).join(' & ')}</span>`;
    awardsBox.appendChild(div);
  });
  document.getElementById('winner-overlay').classList.remove('hidden');
  playWinSound();
});
document.getElementById('btn-close-winner').addEventListener('click', () => {
  document.getElementById('winner-overlay').classList.add('hidden');
});

// ---------- BOARD RENDER (mini bar, always visible) ----------
let estimateTriggerFields = [5, 8, 13, 18]; // Standardwert, wird vom Server überschrieben

function renderBoard(players, positionsOverride) {
  const track = document.getElementById('board-track');
  const BOARD_LENGTH = 26;
  track.innerHTML = '';
  for (let i = 0; i <= BOARD_LENGTH; i++) {
    const field = document.createElement('div');
    let cls = 'board-field' + (i === BOARD_LENGTH ? ' finish' : '');
    if (estimateTriggerFields.includes(i)) cls += ' estimate-field';
    field.className = cls;
    field.textContent = i === BOARD_LENGTH ? '🏁' : i;
    const here = players.filter(p => (positionsOverride ? positionsOverride[p.id] : p.position) === i);
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
const BOARD_LENGTH = 26;
const BOARD_SLOTS = BOARD_LENGTH + 1; // Felder 0..20
const HOP_MS = 380; // Dauer pro Feld-Hop bei der Animation
let roundStartPositions = {};
let miniBarShowsLive = true; // Mini-Leiste zeigt neue Positionen erst, sobald das große Spielbrett sie enthüllt

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

// Berechnet für jede Figur einen Versatz: allein auf dem Feld -> Mitte, mehrere -> aufgefächert
function computeTokenOffsets(players, positionsMap) {
  const groups = {};
  players.forEach(p => {
    const pos = positionsMap[p.id];
    if (!groups[pos]) groups[pos] = [];
    groups[pos].push(p.id);
  });
  const offsets = {};
  Object.values(groups).forEach(ids => {
    if (ids.length === 1) {
      offsets[ids[0]] = { dx: 0, dy: 0 };
    } else {
      ids.forEach((id, idx) => {
        offsets[id] = { dx: (idx % 3) * 9 - 9, dy: Math.floor(idx / 3) * 9 - 9 };
      });
    }
  });
  return offsets;
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
  const startPositionsMap = {};
  players.forEach(p => { startPositionsMap[p.id] = animate ? (fromPositions[p.id] ?? p.position) : p.position; });
  const startOffsets = computeTokenOffsets(players, startPositionsMap);

  players.forEach(p => {
    const tok = document.createElement('span');
    tok.className = 'board-token-rect';
    tok.textContent = avatarFor(p);
    tok.title = p.name;
    const startPos = startPositionsMap[p.id];
    const pos = fieldPercent(startPos, BOARD_SLOTS);
    tok.style.left = pos.x + '%';
    tok.style.top = pos.y + '%';
    const off = startOffsets[p.id] || { dx: 0, dy: 0 };
    tok.style.transform = `translate(${off.dx}px, ${off.dy}px)`;
    tokensBox.appendChild(tok);
    tokenEls[p.id] = tok;
  });

  if (animate) {
    // Figuren ziehen nacheinander, nicht gleichzeitig - macht jede Bewegung einzeln sichtbar
    const movers = players
      .map(p => ({ p, start: fromPositions[p.id] ?? p.position, steps: p.position - (fromPositions[p.id] ?? p.position) }))
      .filter(m => m.steps > 0);

    const currentDisplayPositions = { ...startPositionsMap };
    let cumulativeDelay = 0;
    const PAUSE_BETWEEN_PLAYERS = 250;

    function applyAllTokenPositions() {
      const offs = computeTokenOffsets(players, currentDisplayPositions);
      players.forEach(pp => {
        const tok = tokenEls[pp.id];
        if (!tok) return;
        const pos = fieldPercent(currentDisplayPositions[pp.id], BOARD_SLOTS);
        tok.style.left = pos.x + '%';
        tok.style.top = pos.y + '%';
        const off = offs[pp.id] || { dx: 0, dy: 0 };
        tok.style.transform = `translate(${off.dx}px, ${off.dy}px)`;
      });
    }

    movers.forEach(({ p, start, steps }) => {
      for (let s = 1; s <= steps; s++) {
        const delay = cumulativeDelay + s * HOP_MS;
        setTimeout(() => {
          currentDisplayPositions[p.id] = start + s;
          playHopSound();
          applyAllTokenPositions();
        }, delay);
      }
      cumulativeDelay += steps * HOP_MS + PAUSE_BETWEEN_PLAYERS;
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

// ---------- LOBBY PLAYER LIST (mit Host-Kick-Funktion) ----------
let pendingKickId = null;
let lastLobbyState = null;

function renderLobbyPlayerList(state) {
  lastLobbyState = state;
  const isHost = state.hostId === myId;
  const list = document.getElementById('player-list');
  list.innerHTML = '';

  state.players.forEach(p => {
    const li = document.createElement('li');
    const isMod = p.id === state.moderatorId;
    li.className = p.connected === false ? 'disconnected' : '';

    if (pendingKickId === p.id) {
      li.innerHTML = `
        <span class="kick-confirm-text">${escapeHtml(p.name)} wirklich entfernen?</span>
        <span class="kick-confirm-actions">
          <button class="btn-kick-yes">Ja, entfernen</button>
          <button class="btn-kick-no">Abbrechen</button>
        </span>
      `;
      li.querySelector('.btn-kick-yes').addEventListener('click', () => {
        socket.emit('kickPlayer', { code: currentCode, targetPlayerId: p.id });
        pendingKickId = null;
      });
      li.querySelector('.btn-kick-no').addEventListener('click', () => {
        pendingKickId = null;
        renderLobbyPlayerList(lastLobbyState);
      });
      list.appendChild(li);
      return;
    }

    li.innerHTML = `<span><span class="player-avatar">${avatarFor(p)}</span><span class="player-name">${escapeHtml(p.name)}${p.id === myId ? ' (du)' : ''}</span>${p.connected === false ? '<span class="tag-offline">getrennt</span>' : ''}</span>`;
    if (isMod) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Moderator';
      li.appendChild(tag);
    }
    if (isHost && p.id !== myId) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'btn-kick';
      kickBtn.title = 'Spieler entfernen';
      kickBtn.textContent = '🚫';
      kickBtn.addEventListener('click', () => {
        pendingKickId = p.id;
        renderLobbyPlayerList(lastLobbyState);
      });
      li.appendChild(kickBtn);
    }
    list.appendChild(li);
  });
}

socket.on('kicked', () => {
  clearSession();
  currentCode = null;
  myId = null;
  lastState = null;
  document.getElementById('board-bar').classList.add('hidden');
  showError('Du wurdest vom Host aus dem Raum entfernt.');
  showScreen('start');
});

function updateConnectionBanner(state) {
  const banner = document.getElementById('connection-issue-banner');
  const disconnected = (state.players || []).filter(p => p.connected === false && p.id !== myId);
  if (disconnected.length === 0) {
    banner.classList.add('hidden');
    return;
  }
  const names = disconnected.map(p => p.name).join(', ');
  banner.textContent = `⚠️ Verbindungsprobleme bei ${names} – das Spiel läuft trotzdem normal weiter.`;
  banner.classList.remove('hidden');
}

// ---------- MAIN STATE HANDLER ----------
socket.on('state', (state) => {
  const enteringVoting = state.phase === 'voting' && (!lastState || lastState.phase !== 'voting');
  if (enteringVoting) {
    if (state.myVote) {
      selectedVote = state.myVote;
      voteSubmitted = true;
    } else {
      selectedVote = null;
      voteSubmitted = false;
    }
  }
  const enteringAnswering = state.phase === 'answering' && (!lastState || lastState.phase !== 'answering');
  const enteringBoard = state.phase === 'board' && (!lastState || lastState.phase !== 'board');
  const enteringReveal = state.phase === 'reveal' && (!lastState || lastState.phase !== 'reveal');
  if (enteringReveal) playRevealSound();
  if (enteringAnswering) {
    miniBarShowsLive = false;
    roundStartPositions = {};
    state.players.forEach(p => { roundStartPositions[p.id] = p.position; });
    const ta = document.getElementById('input-answer');
    const num = document.getElementById('input-answer-number');
    document.getElementById('answer-reject-msg').classList.add('hidden');
    if (state.myAnswerSubmitted) {
      // Reload/Reconnect während der Antwort-Phase: eigenen Stand wiederherstellen,
      // statt das Feld fälschlich leer zurückzusetzen (sonst laufen Spieler auseinander)
      ta.value = state.myAnswerText || '';
      num.value = state.myAnswerText || '';
      ta.disabled = false;
      num.disabled = false;
      document.getElementById('btn-submit-answer').disabled = false;
      document.getElementById('btn-submit-answer').textContent = 'Antwort abgeschickt ✓ (Änderung möglich)';
    } else {
      ta.value = ''; ta.disabled = false;
      num.value = ''; num.disabled = false;
      document.getElementById('btn-submit-answer').disabled = false;
      document.getElementById('btn-submit-answer').textContent = 'Antwort abschicken';
    }
  }
  if (enteringBoard) {
    miniBarShowsLive = true;
  }

  lastState = state;
  updateConnectionBanner(state);
  if (state.estimateTriggerFields) estimateTriggerFields = state.estimateTriggerFields;
  const iAmModerator = state.moderatorId === myId;

  renderBoard(state.players, miniBarShowsLive ? null : roundStartPositions);

  document.querySelectorAll('.mod-only').forEach(el => el.style.display = iAmModerator ? 'block' : 'none');
  document.querySelectorAll('.mod-hide').forEach(el => el.style.display = iAmModerator ? 'none' : 'block');

  if (state.phase === 'lobby') {
    document.getElementById('room-code-display').textContent = state.code;
    renderLobbyPlayerList(state);
    document.getElementById('btn-start-round').style.display = (state.players.length >= 3 && iAmModerator) ? 'block' : 'none';
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
      : 'Denk dir eine überzeugende Antwort aus:';
    document.getElementById('input-answer').classList.toggle('hidden', isEstimate);
    document.getElementById('input-answer-number').classList.toggle('hidden', !isEstimate);
    document.getElementById('btn-to-voting').classList.add('hidden');
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
        div.innerHTML = `${shownText}${statusTag}<br><span class="owner">${escapeHtml(a.name)}</span>`;
        previewBox.appendChild(div);
      });

      const dcBox = document.getElementById('duplicate-conflict-box');
      if ((state.duplicateConflicts || []).length > 0) {
        dcBox.classList.remove('hidden');
        dcBox.innerHTML = '';
        state.duplicateConflicts.forEach(c => {
          const div = document.createElement('div');
          div.innerHTML = `
            <h4>⚠️ Dopplung: ${escapeHtml(c.name)}s Antwort ist fast identisch mit der echten Antwort</h4>
            <p class="dc-text">"${escapeHtml(String(c.answerText))}"</p>
            <p class="dc-text" style="margin-bottom:14px;">Beide sind quasi dieselbe Antwort. Wähle, welche davon im Spiel bleibt:</p>
            <div class="dc-actions">
              <button class="btn-dc-remove">Echte Antwort behalten (${escapeHtml(c.name)}s Version raus)</button>
              <button class="btn-dc-keep">${escapeHtml(c.name)}s Version behalten (offizielle Antwort raus)</button>
            </div>
          `;
          div.querySelector('.btn-dc-remove').addEventListener('click', () => {
            socket.emit('resolveDuplicate', { code: currentCode, playerId: c.playerId, action: 'keepReal' });
          });
          div.querySelector('.btn-dc-keep').addEventListener('click', () => {
            socket.emit('resolveDuplicate', { code: currentCode, playerId: c.playerId, action: 'keepPlayerVersion' });
          });
          dcBox.appendChild(div);
        });
      } else {
        dcBox.classList.add('hidden');
      }
    } else {
      document.getElementById('answer-input-box').classList.remove('hidden');
      document.getElementById('moderator-wait-box').classList.add('hidden');
      document.getElementById('real-answer-box').classList.add('hidden');
      document.getElementById('moderator-answers-preview').classList.add('hidden');
      document.getElementById('duplicate-conflict-box').classList.add('hidden');

      // Sobald alle abgeschickt haben, keine weiteren Änderungen mehr zulassen
      const allAnswered = state.answeredCount >= Math.max(state.players.length - 1, 0);
      if (allAnswered) {
        document.getElementById('input-answer').disabled = true;
        document.getElementById('input-answer-number').disabled = true;
        document.getElementById('btn-submit-answer').disabled = true;
        document.getElementById('btn-submit-answer').textContent = 'Alle fertig – keine Änderung mehr möglich';
      }
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
      document.getElementById('vote-submitted-msg').classList.add('hidden');
      document.getElementById('vote-question-hint').classList.add('hidden');
      document.getElementById('moderator-vote-wait').classList.remove('hidden');

      const optionsBox = document.getElementById('moderator-answer-options');
      optionsBox.classList.remove('hidden');
      optionsBox.innerHTML = '';
      (state.shuffledAnswers || []).forEach(a => {
        const div = document.createElement('div');
        div.className = 'reveal-item';
        div.textContent = a.text;
        optionsBox.appendChild(div);
      });

      const previewBox = document.getElementById('moderator-vote-preview');
      previewBox.classList.remove('hidden');
      previewBox.innerHTML = '';
      (state.votePreview || []).forEach(v => {
        const chosenAnswer = state.shuffledAnswers.find(a => a.ownerId === v.chosenOwnerId);
        const div = document.createElement('div');
        div.className = 'reveal-item' + (v.submitted ? '' : ' typing-preview');
        const text = chosenAnswer ? escapeHtml(chosenAnswer.text) : '<span class="placeholder-text">noch keine Auswahl</span>';
        const statusTag = v.submitted ? '' : (chosenAnswer ? '<span class="typing-tag">tippt gerade drauf …</span>' : '');
        div.innerHTML = `${text}${statusTag}<br><span class="owner">${escapeHtml(v.name)}</span>`;
        previewBox.appendChild(div);
      });
    } else {
      document.getElementById('moderator-vote-wait').classList.add('hidden');
      document.getElementById('moderator-answer-options').classList.add('hidden');
      document.getElementById('moderator-vote-preview').classList.add('hidden');
      document.getElementById('vote-question-hint').classList.remove('hidden');
      if (enteringVoting) {
        document.getElementById('vote-options').classList.remove('hidden');
        renderVoteOptions(state.shuffledAnswers);
        if (voteSubmitted) {
          // Reload/Reconnect nach bereits abgegebener Stimme: gesperrten Zustand zeigen,
          // statt die Auswahl fälschlich wieder freizugeben
          document.querySelectorAll('.vote-option').forEach(el => {
            el.style.pointerEvents = 'none';
            if (el.dataset.ownerId === selectedVote) el.classList.add('selected');
          });
          document.getElementById('btn-submit-vote').classList.add('hidden');
          document.getElementById('vote-submitted-msg').classList.remove('hidden');
        } else {
          document.getElementById('btn-submit-vote').classList.remove('hidden');
          document.getElementById('btn-submit-vote').disabled = true;
          document.getElementById('vote-submitted-msg').classList.add('hidden');
        }
      }
    }
    showScreen('voting');
  }

  if (state.phase === 'reveal') {
    const catchupBanner = document.getElementById('catchup-banner');
    if (state.catchUpAnnouncement) {
      const { names, amount } = state.catchUpAnnouncement;
      catchupBanner.textContent = `🚀 Aufholjagd! ${names.join(' & ')} bekommt +${amount} Bonus-Felder!`;
      catchupBanner.classList.remove('hidden');
    } else {
      catchupBanner.classList.add('hidden');
    }
    document.getElementById('question-text-4').textContent = state.currentQuestion || '';
    const list = document.getElementById('reveal-list');
    const realBox = document.getElementById('estimate-real-answer');
    list.innerHTML = '';

    if (state.roundType === 'estimate') {
      realBox.classList.remove('hidden');
      realBox.textContent = 'Echte Zahl: ' + state.estimateRealAnswer;
      const medals = ['🥇', '🥈', '🥉'];
      const closenessCallouts = ['🎯 Am nächsten dran!', '👏 Ziemlich nah dran', '👍 Auch nicht schlecht'];
      (state.estimateResults || []).forEach(r => {
        const div = document.createElement('div');
        div.className = 'reveal-item' + (r.points > 0 ? ' real' : '');
        const medal = medals[r.rank - 1] || `${r.rank}.`;
        const callout = r.points > 0 ? (closenessCallouts[r.rank - 1] || '') : '';
        const pointsText = r.points > 0 ? `+${r.points} Punkte` : 'keine Punkte';
        div.innerHTML = `${medal} ${escapeHtml(r.name)}: <strong>${r.value}</strong>${callout ? ` <span class="closeness-tag">${callout}</span>` : ''}<br><span class="owner">${pointsText}</span>`;
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
        const myVoteBadge = isMyVote
          ? `<span class="my-vote-badge">${a.isReal ? `✔ Richtig getippt! (+${state.pointsCorrectGuess} Punkte)` : '✗ Reingefallen'}</span>`
          : '';
        const foolerNamesText = (a.foolerNames || []).map(escapeHtml).join(', ');
        const foolCallout = (!a.isReal && a.foolCount > 0)
          ? `<span class="fool-callout">🎣 ${foolerNamesText} ${a.foolCount === 1 ? 'ist' : 'sind'} darauf reingefallen! ${ownerName} bekommt +${a.foolCount * state.pointsPerFooled} Punkte</span>`
          : '';
        div.innerHTML = `${escapeHtml(a.text)}<br><span class="owner">${ownerName}</span>${myVoteBadge}${foolCallout}`;
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

