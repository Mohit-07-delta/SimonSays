/* display.js — lobby counter + sequence animation + round/win */

const socket = io();

// ── Timing constants ──────────────────────────────────
const FLASH_MS  = 700;  // how long each color stays lit
const GAP_MS    = 250;  // gap between flashes
const PAUSE_MS  = 500;  // pause before sequence starts

// DOM references
const idleView = document.getElementById('idle-view');
const gameView = document.getElementById('game-view');
const gameoverView = document.getElementById('gameover-view');
const leaderboardView = document.getElementById('leaderboard-view');
const countIdle = document.getElementById('count-idle');
const roundNumber = document.getElementById('round-number');
const playersAlive = document.getElementById('players-alive');
const displayStatus = document.getElementById('display-status');
const colorPads = document.querySelectorAll('.color-pad');
const roundSummary = document.getElementById('round-summary');
const summaryEliminated = document.getElementById('summary-eliminated');
const summaryRemaining = document.getElementById('summary-remaining');
const winnerName = document.getElementById('winner-name');
const winnerSubtitle = document.getElementById('winner-subtitle');

const lbPodiums = {
  1: document.getElementById('lb-podium-1'),
  2: document.getElementById('lb-podium-2'),
  3: document.getElementById('lb-podium-3')
};
const lbList = document.getElementById('lb-list');

const sfxWin = document.getElementById('sfx-win');
const confettiCanvas = document.getElementById('confetti');

const qrImg = document.getElementById('qr-img');
const qrUrl = document.getElementById('qr-url');

// Pad lookup by color name
const padMap = {
  red:    document.getElementById('pad-red'),
  blue:   document.getElementById('pad-blue'),
  green:  document.getElementById('pad-green'),
  yellow: document.getElementById('pad-yellow'),
};

// ── Server Info (QR code) ─────────────────────────────
socket.on('server-info', (data) => {
  if (data.qr) {
    qrImg.src = data.qr;
    qrImg.style.display = 'block';
  }
  if (data.url) {
    qrUrl.textContent = data.url;
  }
});

// Show a specific view
function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  view.classList.add('active');
}

// ── Lobby updates ─────────────────────────────────────
socket.on('lobby-update', (data) => {
  countIdle.textContent = data.count;
  countIdle.style.transform = 'scale(1.3)';
  setTimeout(() => { countIdle.style.transform = 'scale(1)'; }, 200);
});

// ── Round info (update header stats) ──────────────────
socket.on('round-info', (data) => {
  roundNumber.textContent = data.round;
  playersAlive.textContent = data.alive;
});

// ── Sequence animation ────────────────────────────────
function dimAllPads() {
  Object.values(padMap).forEach(pad => {
    pad.classList.remove('flash');
    pad.classList.add('dim');
  });
}

function resetAllPads() {
  Object.values(padMap).forEach(pad => {
    pad.classList.remove('flash', 'dim');
  });
}

function flashPad(color) {
  return new Promise(resolve => {
    const pad = padMap[color];
    if (!pad) return resolve();

    // Light up
    pad.classList.remove('dim');
    pad.classList.add('flash');

    setTimeout(() => {
      // Dim back down
      pad.classList.remove('flash');
      pad.classList.add('dim');
      // Gap before next flash
      setTimeout(resolve, GAP_MS);
    }, FLASH_MS);
  });
}

async function playSequence(sequence) {
  displayStatus.textContent = 'Watch closely\u2026';

  // Dim all pads first
  dimAllPads();
  await new Promise(r => setTimeout(r, PAUSE_MS));

  // Flash each color in order
  for (const color of sequence) {
    await flashPad(color);
  }

  // Restore pads to normal
  resetAllPads();
  displayStatus.textContent = 'Players\' turn!';

  // Notify server that animation is done
  socket.emit('sequence-shown-complete');
}

socket.on('show-sequence', (data) => {
  // Switch from idle to game view if needed
  if (!gameView.classList.contains('active')) {
    showView(gameView);
  }
  // Hide any round summary from previous round
  roundSummary.classList.add('hidden');
  roundNumber.textContent = data.round;
  playSequence(data.sequence);
});

// ── Your-turn event (update status text) ──────────────
socket.on('your-turn', () => {
  displayStatus.textContent = 'Players\' turn!';
});

// ── Round complete — show elimination stats ───────────
socket.on('round-complete', (data) => {
  displayStatus.textContent = 'Round complete!';

  // Show summary overlay
  const elimText = data.eliminatedCount === 0
    ? 'No one eliminated!'
    : `${data.eliminatedCount} player${data.eliminatedCount !== 1 ? 's' : ''} eliminated`;
  summaryEliminated.textContent = elimText;
  summaryRemaining.textContent = `${data.totalAlive} player${data.totalAlive !== 1 ? 's' : ''} remaining`;

  // Re-trigger animation by removing and re-adding
  roundSummary.classList.add('hidden');
  void roundSummary.offsetWidth;
  roundSummary.classList.remove('hidden');
});

// ── Confetti ──────────────────────────────────────────
function startConfetti() {
  confettiCanvas.classList.add('active');
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
  const ctx = confettiCanvas.getContext('2d');
  
  const particles = [];
  const colors = ['#ff3b5c', '#3b8bff', '#2ee89e', '#ffd642'];
  
  for (let i = 0; i < 150; i++) {
    particles.push({
      x: Math.random() * confettiCanvas.width,
      y: Math.random() * -confettiCanvas.height,
      r: Math.random() * 6 + 2,
      dx: Math.random() * 4 - 2,
      dy: Math.random() * 5 + 2,
      color: colors[Math.floor(Math.random() * colors.length)]
    });
  }

  function animate() {
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    let active = false;
    particles.forEach(p => {
      p.x += p.dx;
      p.y += p.dy;
      if (p.y < confettiCanvas.height) active = true;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });
    if (active) requestAnimationFrame(animate);
  }
  animate();
}

// ── Game over — show winner ───────────────────────────
socket.on('game:winner', (data) => {
  const lbData = data.leaderboard || [];

  // Hide all podiums initially
  [1, 2, 3].forEach(rank => lbPodiums[rank].style.visibility = 'hidden');
  lbList.innerHTML = ''; // clear list

  lbData.forEach((player, index) => {
    const rank = index + 1;
    if (rank <= 3) {
      // Podium
      const podiumItem = lbPodiums[rank];
      if (podiumItem) {
        podiumItem.querySelector('.lb-name').textContent = player.name;
        podiumItem.querySelector('.lb-score').textContent = `${player.score} points`;
        podiumItem.style.visibility = 'visible';
      }
    } else {
      // List
      const row = document.createElement('div');
      row.className = 'lb-row';
      row.style.animationDelay = `${0.3 + (rank * 0.1)}s`;
      row.innerHTML = `
        <div class="row-rank">${rank}</div>
        <div class="row-name">${player.name}</div>
        <div class="row-score">${player.score} points</div>
      `;
      lbList.appendChild(row);
    }
  });

  // Switch straight to leaderboard view
  showView(leaderboardView);

  // Audio & Visuals
  sfxWin.currentTime = 0;
  sfxWin.play().catch(() => {});
  startConfetti();
});

// ── Game Restarted ────────────────────────────────────
socket.on('game-restarted', () => {
  showView(gameView);
  roundSummary.classList.add('hidden');
  confettiCanvas.classList.remove('active');
});

// ── Force Reset ───────────────────────────────────────
socket.on('force-reset', () => {
  window.location.reload();
});

// Socket connection logging
socket.on('connect', () => {
  console.log('Display connected:', socket.id);
});

socket.on('disconnect', () => {
  console.log('Display disconnected');
});
