/* host.js — join flow + lobby management */

const socket = io();

// DOM references
const btnStart = document.getElementById('btn-start');
const btnNextRound = document.getElementById('btn-next-round');
const btnReset = document.getElementById('btn-reset');
const difficultySelect = document.getElementById('difficulty-select');
const eventLog = document.getElementById('event-log');
const statRound = document.getElementById('stat-round');
const statAlive = document.getElementById('stat-alive');
const statTotal = document.getElementById('stat-total');
const qrImg = document.getElementById('qr-img');
const qrUrl = document.getElementById('qr-url');

let minPlayers = 1;

// Start buttons begin disabled
btnStart.disabled = true;
btnStart.style.opacity = '0.4';
btnStart.style.cursor = 'not-allowed';

btnNextRound.disabled = true;
btnNextRound.style.opacity = '0.4';
btnNextRound.style.cursor = 'not-allowed';

// ── Server Info ───────────────────────────────────────
socket.on('server-info', (data) => {
  if (data.qr) {
    qrImg.src = data.qr;
    qrImg.style.display = 'inline-block';
  }
  if (data.url) {
    qrUrl.textContent = data.url;
  }
});

// Append a line to the event log
function log(message) {
  const time = new Date().toLocaleTimeString();
  eventLog.innerHTML += `<div>[${time}] ${message}</div>`;
  eventLog.scrollTop = eventLog.scrollHeight;
}

// Update Start button enabled state
function updateStartBtn(count) {
  const canStart = count >= minPlayers;
  btnStart.disabled = !canStart;
  btnStart.style.opacity = canStart ? '1' : '0.4';
  btnStart.style.cursor = canStart ? 'pointer' : 'not-allowed';
}

// ── Lobby updates ─────────────────────────────────────
socket.on('lobby-update', (data) => {
  minPlayers = data.minPlayers || minPlayers;
  statTotal.textContent = data.count;
  statAlive.textContent = data.count; // everyone alive in lobby
  updateStartBtn(data.count);
  btnStart.textContent = '▶ Start Game';
  log(`Lobby: ${data.count} player(s) — ${data.names[data.names.length - 1] || '?'}`);
});

// ── Round info updates ────────────────────────────────
socket.on('round-info', (data) => {
  statRound.textContent = data.round;
  statAlive.textContent = data.alive;
  statTotal.textContent = data.total;
  log(`Round ${data.round} — ${data.alive} alive`);
  // Change Start button to Restart and keep it enabled
  setBtnEnabled(btnStart, true);
  btnStart.textContent = '⟲ Restart Game';
  // Disable buttons while sequence is showing
  setBtnEnabled(btnNextRound, false);
});

socket.on('your-turn', () => {
  log('Sequence shown — players\' turn');
});

// ── Round complete ────────────────────────────────────
socket.on('round-complete', (data) => {
  log(`Round ${data.round} done: ${data.eliminatedCount} eliminated, ${data.totalAlive} alive`);
  // Re-enable Next Round
  setBtnEnabled(btnNextRound, true);
});

// ── Game over ─────────────────────────────────────────
socket.on('game:winner', (data) => {
  log(`🏆 Game over. Winner: ${data.winners.join(', ') || 'Nobody'}`);
  setBtnEnabled(btnNextRound, false);
  setBtnEnabled(btnStart, true);
  btnStart.textContent = '⟲ Restart Game';
});

function setBtnEnabled(btn, enabled) {
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.4';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

// Button handlers
btnStart.addEventListener('click', () => {
  if (btnStart.disabled) return;
  const difficulty = difficultySelect.value;
  console.log('Host: Start Game', difficulty);
  log(`▶ Start Game (${difficulty})`);
  socket.emit('start-game', difficulty);
});

btnNextRound.addEventListener('click', () => {
  if (btnNextRound.disabled) return;
  console.log('Host: Next Round');
  log('⏭ Next Round');
  socket.emit('next-round');
});

btnReset.addEventListener('click', () => {
  if (!confirm('Are you sure you want to force reset the game? This will disconnect everyone.')) return;
  console.log('Host: Force Reset');
  log('\u27f2 Force Reset pressed');
  socket.emit('force-reset');
});

// ── Force Reset ───────────────────────────────────────
socket.on('force-reset', () => {
  window.location.reload();
});

// Socket connection logging
socket.on('connect', () => {
  console.log('Host connected:', socket.id);
  log('Connected to server');
});

socket.on('disconnect', () => {
  console.log('Host disconnected');
  log('Disconnected from server');
});
