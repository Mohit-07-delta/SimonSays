/* player.js — join flow + input handling */

const socket = io();

// DOM references
const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const spectatorScreen = document.getElementById('spectator-screen');
const joinForm = document.getElementById('join-form');
const playerNameInput = document.getElementById('player-name');
const joinBtn = joinForm.querySelector('.btn-join');
const hintEl = document.querySelector('.hint');
const buttonGrid = document.getElementById('button-grid');
const colorButtons = document.querySelectorAll('.color-btn');
const avatarDisplay = document.getElementById('player-avatar-display');
const instruction = document.getElementById('instruction');
const roundLabel = document.getElementById('round-label');
const playerStatus = document.getElementById('player-status');
const timerContainer = document.getElementById('timer-container');
const timerBar = document.getElementById('timer-bar');
const timerText = document.getElementById('timer-text');
const spectatorRound = document.getElementById('spectator-round');
const spectatorRemaining = document.getElementById('spectator-remaining');

const countdownOverlay = document.getElementById('countdown-overlay');
const countdownText = document.getElementById('countdown-text');

// Audio elements
const sfxTap = document.getElementById('sfx-tap');
const sfxEliminated = document.getElementById('sfx-eliminated');

let myName = '';
let inputEnabled = false;
let countdownInterval = null;
let countdownAnimation = null;

// Show a specific screen
function showScreen(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

// ── Join ──────────────────────────────────────────────
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = playerNameInput.value.trim();
  const avatarRadio = document.querySelector('input[name="avatar"]:checked');
  const avatar = avatarRadio ? avatarRadio.value : 'ironman';
  
  if (!name) return;

  joinBtn.disabled = true;
  joinBtn.textContent = 'Joining…';

  socket.emit('join', { name, avatar }, (res) => {
    if (res.ok) {
      myName = res.name;
      
      // Update UI with avatar
      const ext = res.avatar && res.avatar.includes('.') ? '' : '.jpg';
      avatarDisplay.style.backgroundImage = `url('/avatars/${res.avatar}${ext}')`;
      
      showScreen(gameScreen);
      disableButtons();
      instruction.textContent = 'You\'re in! Waiting for host to start…';
    } else {
      hintEl.textContent = res.reason || 'Could not join';
      hintEl.style.color = '#ff3b5c';
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join Game';
    }
  });
});

// Live lobby counter on join screen
socket.on('lobby-update', (data) => {
  if (joinScreen.classList.contains('active')) {
    hintEl.textContent = `${data.count} player${data.count !== 1 ? 's' : ''} joined · Waiting for host…`;
    hintEl.style.color = '';
  }
});

// ── Button state helpers ──────────────────────────────
function enableButtons() {
  inputEnabled = true;
  buttonGrid.classList.remove('disabled');
}

function disableButtons() {
  inputEnabled = false;
  buttonGrid.classList.add('disabled');
}

// ── Countdown timer ──────────────────────────────────
function startCountdown(durationMs) {
  const totalSec = Math.ceil(durationMs / 1000);
  let remaining = totalSec;

  // Show timer
  timerContainer.classList.remove('hidden');
  timerBar.classList.remove('warning');
  timerText.classList.remove('warning');
  timerText.textContent = remaining + 's';

  // Animate the bar shrinking
  timerBar.style.transition = 'none';
  timerBar.style.transform = 'scaleX(1)';
  // Force reflow so the reset takes effect before we animate
  void timerBar.offsetWidth;
  timerBar.style.transition = `transform ${durationMs}ms linear`;
  timerBar.style.transform = 'scaleX(0)';

  // Tick the text countdown
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      remaining = 0;
      clearInterval(countdownInterval);
    }
    timerText.textContent = remaining + 's';

    // Warning state in last 3 seconds
    if (remaining <= 3) {
      timerBar.classList.add('warning');
      timerText.classList.add('warning');
    }
  }, 1000);
}

function stopCountdown() {
  clearInterval(countdownInterval);
  timerContainer.classList.add('hidden');
  timerBar.style.transition = 'none';
  timerBar.style.transform = 'scaleX(1)';
}

// ── Your Turn — enable input ─────────────────────────
socket.on('your-turn', (data) => {
  // Only respond if we're on the game screen (alive)
  if (!gameScreen.classList.contains('active')) return;

  roundLabel.textContent = `Round ${data.round}`;
  instruction.textContent = 'Your turn — tap the sequence!';
  enableButtons();
  startCountdown(data.timeout || 10000);
});

// ── Color button taps ────────────────────────────────
colorButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!inputEnabled) return;

    const color = btn.dataset.color;
    socket.emit('player:tap', color);

    // Play tap sound
    sfxTap.currentTime = 0;
    sfxTap.play().catch(() => {});

    // Visual flash feedback
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 200);
  });
});

// ── Round survived ───────────────────────────────────
socket.on('round-survived', () => {
  disableButtons();
  stopCountdown();
  instruction.textContent = '✓ You survived this round!';

  // Green pulse on the game screen
  gameScreen.classList.add('survived-flash');
  setTimeout(() => gameScreen.classList.remove('survived-flash'), 600);
});

// ── Eliminated ───────────────────────────────────────
socket.on('eliminated', (data) => {
  disableButtons();
  stopCountdown();
  inputEnabled = false;

  // Play elimination sound
  sfxEliminated.currentTime = 0;
  sfxEliminated.play().catch(() => {});

  // Update the spectator screen info
  spectatorRound.textContent = data.round || '?';
  
  showScreen(spectatorScreen);
});

// ── Round info (keep round label & spectator stats updated)
socket.on('round-info', (data) => {
  roundLabel.textContent = `Round ${data.round}`;
  if (spectatorScreen.classList.contains('active')) {
    spectatorRemaining.textContent = data.alive;
  }
});

// ── Show-sequence phase — disable buttons while sequence plays
socket.on('show-sequence', () => {
  if (!gameScreen.classList.contains('active')) return;
  disableButtons();
  stopCountdown();
  instruction.textContent = 'Watch the display screen…';
});

// ── Round complete (waiting for next round) ───────────
socket.on('round-complete', () => {
  if (!gameScreen.classList.contains('active')) return;
  disableButtons();
  instruction.textContent = 'Waiting for next round…';
});

// ── Input Phase ───────────────────────────────────────
socket.on('round:input-open', (data) => {
  if (!gameScreen.classList.contains('active')) return;
  enableButtons();
  instruction.textContent = 'Your turn!';
  startCountdown(data.duration);
});

// ── Spectator / Elimination ───────────────────────────
socket.on('eliminated', (data) => {
  stopCountdown();
  showScreen(spectatorScreen);
  spectatorRoundInfo.textContent = data.round;
  spectatorRemaining.textContent = data.alive;
  
  sfxEliminated.currentTime = 0;
  sfxEliminated.play().catch(() => {});
});

// ── Start game/sequence ───────────────────────────────
socket.on('countdown', (data) => {
  showScreen(gameScreen);
  if (data.count === 'GO!' || data.count === 0) {
    countdownText.textContent = 'GO!';
    setTimeout(() => {
      countdownOverlay.classList.add('hidden');
    }, 800);
  } else {
    countdownOverlay.classList.remove('hidden');
    countdownText.textContent = data.count;
  }
});

// ── Game Restarted ────────────────────────────────────
socket.on('game-restarted', () => {
  showScreen(gameScreen);
  disableButtons();
  instruction.textContent = 'Game Restarting...';
  
  stopCountdown();
});

// ── Force Reset ───────────────────────────────────────
socket.on('force-reset', () => {
  window.location.reload();
});

// Socket connection logging
socket.on('connect', () => {
  console.log('Connected to server:', socket.id);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});
