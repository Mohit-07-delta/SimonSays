const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 1; // minimum players before host can start
const ROUND_TIMEOUT_MS = 10000; // 10 seconds for players to input

// Difficulty Settings
const DIFF_CONFIG = {
  normal: { timeout: 10000, startFlash: 700, gap: 250, colorsPerRound: 1 },
  hard:   { timeout: 5000, startFlash: 700, gap: 200, colorsPerRound: 2, flashDecay: 50, minFlash: 250 }
};

let roundTimer = null; // server-side timeout handle

// ── Server Info & QR Code ───────────────────────────
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Return the first IPv4 address that isn't internal (localhost)
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIp();
const serverUrl = process.env.PUBLIC_URL || `http://${localIp}:${PORT}`;
let qrDataUrl = '';

qrcode.toDataURL(serverUrl, { margin: 2, scale: 8 }, (err, url) => {
  if (!err) qrDataUrl = url;
});

const COLORS = ['red', 'blue', 'green', 'yellow'];

// ── Game State ───────────────────────────────────────
const gameState = {
  phase: 'lobby', // lobby | showing-sequence | player-input | round-complete | game-over
  players: {},    // keyed by socket.id → { name, alive, progress, survived }
  round: 0,
  sequence: [],
  aliveAtRoundStart: 0, // snapshot for calculating eliminations
  difficulty: 'normal'
};

// ── Round helpers ────────────────────────────────────
function startNextRound() {
  const diff = DIFF_CONFIG[gameState.difficulty] || DIFF_CONFIG.normal;
  
  // Add colors based on difficulty
  for (let i = 0; i < diff.colorsPerRound; i++) {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    gameState.sequence.push(color);
  }
  
  gameState.round++; // Not strictly sequence length anymore
  gameState.phase = 'showing-sequence';

  console.log(`🔔 Round ${gameState.round}: sequence = [${gameState.sequence.join(', ')}]`);

  // Calculate speed for this round
  let flashMs = diff.startFlash;
  let gapMs = diff.gap;
  if (gameState.difficulty === 'hard') {
    flashMs = Math.max(diff.minFlash, diff.startFlash - (gameState.round * diff.flashDecay));
  }

  // Send sequence to display clients only
  io.emit('round-info', { round: gameState.round, alive: aliveCount(), total: playerCount() });
  io.emit('show-sequence', { 
    sequence: [...gameState.sequence], 
    round: gameState.round,
    flashMs: flashMs,
    gapMs: gapMs
  });
}

// Helper: count of all joined players
function playerCount() {
  return Object.keys(gameState.players).length;
}

// Helper: count of alive players
function aliveCount() {
  return Object.values(gameState.players).filter(p => p.alive).length;
}

// Broadcast lobby info to everyone
function broadcastLobby() {
  const count = playerCount();
  const names = Object.values(gameState.players).map(p => p.name);
  io.emit('lobby-update', { count, names, minPlayers: MIN_PLAYERS });
}

// ── Input phase helpers ──────────────────────────────
function openInputPhase() {
  gameState.phase = 'player-input';

  // Reset progress & survived flag for all alive players
  for (const p of Object.values(gameState.players)) {
    if (p.alive) {
      p.progress = 0;
      p.survived = false;
    }
  }

  const diff = DIFF_CONFIG[gameState.difficulty] || DIFF_CONFIG.normal;
  const timeoutMs = diff.timeout;

  console.log(`✅ Round ${gameState.round}: input open (${aliveCount()} alive, ${timeoutMs / 1000}s)`);

  // Snapshot alive count for round-end stats
  gameState.aliveAtRoundStart = aliveCount();

  // Tell players they can start tapping
  io.emit('your-turn', {
    round: gameState.round,
    length: gameState.sequence.length,
    timeout: timeoutMs,
  });

  // Safety timeout — eliminate anyone who hasn't finished
  clearTimeout(roundTimer);
  roundTimer = setTimeout(() => {
    if (gameState.phase !== 'player-input') return;
    console.log('⏰ Round timed out');

    for (const [sid, p] of Object.entries(gameState.players)) {
      if (p.alive && !p.survived) {
        eliminatePlayer(sid, 'timed out');
      }
    }
    checkRoundComplete();
  }, timeoutMs);
}

function eliminatePlayer(socketId, reason) {
  const player = gameState.players[socketId];
  if (!player || !player.alive) return;

  player.alive = false;
  player.highestRound = gameState.round - 1;
  console.log(`💀 ${player.name} eliminated (${reason}) — ${aliveCount()} alive`);

  const sock = io.sockets.sockets.get(socketId);
  if (sock) {
    sock.emit('eliminated', { reason, round: gameState.round });
  }

  // Update display with new alive count
  io.emit('round-info', { round: gameState.round, alive: aliveCount(), total: playerCount() });
}

function checkRoundComplete() {
  const alive = Object.values(gameState.players).filter(p => p.alive);

  // All alive players have either survived or been eliminated
  const allDone = alive.every(p => p.survived);
  if (!allDone) return;

  clearTimeout(roundTimer);

  const survivorCount = alive.length;
  const eliminatedCount = gameState.aliveAtRoundStart - survivorCount;

  console.log(`🏁 Round ${gameState.round} complete — ${survivorCount} survived, ${eliminatedCount} eliminated`);

  // Reset progress for survivors (ready for next round)
  for (const p of alive) {
    p.progress = 0;
    p.survived = false;
  }

  // ── Win condition ──────────────────────────────────
  if (survivorCount <= 1 || survivorCount === 0) {
    gameState.phase = 'game-over';

    // Winners survive the current round
    for (const p of alive) {
      p.highestRound = gameState.round;
    }

    let winners;
    if (survivorCount === 1) {
      winners = [alive[0].name];
    } else {
      // Everyone died in the same round → tie among last-round players
      const lastAlive = Object.values(gameState.players)
        .filter(p => !p.alive && p.highestRound === gameState.round - 1)
        .map(p => p.name);
      winners = lastAlive.length > 0 ? lastAlive : ['Nobody'];
    }

    const leaderboard = Object.values(gameState.players)
      .map(p => ({ name: p.name, avatar: p.avatar, score: p.highestRound || 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    console.log(`🏆 Game over! Winner(s): ${winners.join(', ')}`);
    io.emit('game:winner', { winners, round: gameState.round, leaderboard });
    return;
  }

  // Not game over yet — broadcast round results
  gameState.phase = 'round-complete';
  io.emit('round-info', { round: gameState.round, alive: survivorCount, total: playerCount() });
  io.emit('round-complete', {
    round: gameState.round,
    survivorCount,
    eliminatedCount,
    totalAlive: survivorCount,
  });
}

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Routes for the three pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // Send server info to connecting clients (host/display)
  socket.emit('server-info', { url: serverUrl, qr: qrDataUrl });

  // ── Player joins ────────────────────────────────────
  socket.on('join', (data, callback) => {
    if (gameState.phase !== 'lobby') {
      return callback({ ok: false, reason: 'Game already in progress' });
    }
    
    // Support backward compatibility (old client sending just a string)
    const name = typeof data === 'string' ? data : data.name;
    const avatar = typeof data === 'object' ? (data.avatar || 'avatar_1') : 'avatar_1';

    const safeName = String(name).trim().substring(0, 16);
    if (!safeName) {
      return callback({ ok: false, reason: 'Name is required' });
    }

    gameState.players[socket.id] = {
      name: safeName,
      avatar: avatar,
      alive: true,
      progress: 0,
      highestRound: 0
    };

    console.log(`🙋 ${safeName} joined (${playerCount()} players)`);
    callback({ ok: true, name: safeName, avatar: avatar });
    broadcastLobby();
  });

  // ── Host: Start Game ────────────────────────────────
  socket.on('start-game', (difficulty) => {
    if (playerCount() < MIN_PLAYERS) return;
    gameState.difficulty = difficulty || 'normal';
    console.log(`🚀 Game started by host (Difficulty: ${gameState.difficulty})`);

    // Reset game state but keep players connected
    gameState.round = 0;
    gameState.sequence = [];
    gameState.aliveAtRoundStart = 0;
    clearTimeout(roundTimer);

    for (const p of Object.values(gameState.players)) {
      p.alive = true;
      p.progress = 0;
      p.survived = false;
      p.highestRound = 0;
    }

    // Tell clients to reset their UI to the active game state
    io.emit('game-restarted');

    startNextRound();
  });

  // ── Host: Next Round ────────────────────────────────
  socket.on('next-round', () => {
    if (gameState.phase === 'game-over') return;
    if (gameState.phase !== 'round-complete' && gameState.phase !== 'lobby') return;
    console.log('⏭ Host triggered next round');
    startNextRound();
  });

  // ── Host: Force Reset ───────────────────────────────
  socket.on('force-reset', () => {
    console.log('🔄 Host triggered force reset');
    gameState.phase = 'lobby';
    gameState.players = {};
    gameState.round = 0;
    gameState.sequence = [];
    gameState.aliveAtRoundStart = 0;
    clearTimeout(roundTimer);
    io.emit('force-reset');
  });

  // ── Display: Sequence animation finished ────────────
  socket.on('sequence-shown-complete', () => {
    if (gameState.phase !== 'showing-sequence') return;
    openInputPhase();
  });

  // ── Player taps a color ─────────────────────────────
  socket.on('player:tap', (color) => {
    if (gameState.phase !== 'player-input') return;
    const player = gameState.players[socket.id];
    if (!player || !player.alive) return;

    const expected = gameState.sequence[player.progress];

    if (color === expected) {
      player.progress++;

      // Check if player completed the full sequence
      if (player.progress >= gameState.sequence.length) {
        player.survived = true;
        socket.emit('round-survived');
        console.log(`✅ ${player.name} survived round ${gameState.round}`);
        checkRoundComplete();
      }
    } else {
      // Wrong color → eliminated
      eliminatePlayer(socket.id, 'wrong color');
      checkRoundComplete();
    }
  });

  // ── Disconnect ──────────────────────────────────────
  socket.on('disconnect', () => {
    const player = gameState.players[socket.id];
    if (player) {
      console.log(`👋 ${player.name} left (${playerCount() - 1} players)`);
      delete gameState.players[socket.id];
      broadcastLobby();
      
      // If we are waiting for input, dropping a player might mean the round is now complete
      if (gameState.phase === 'player-input') {
        checkRoundComplete();
      }
    }
    console.log(`[-] Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`\n  🎮 Simon Says server running on http://localhost:${PORT}`);
  console.log(`  📱 Player page:  http://localhost:${PORT}/`);
  console.log(`  🖥️  Display page: http://localhost:${PORT}/display`);
  console.log(`  🎛️  Host page:    http://localhost:${PORT}/host\n`);
});
