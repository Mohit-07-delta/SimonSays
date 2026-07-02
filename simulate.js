const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const NUM_BOTS = 30;
const bots = [];

console.log(`🤖 Starting simulation with ${NUM_BOTS} bots...`);

function createBot(index) {
  const socket = io(SERVER_URL, {
    reconnection: false, // Don't try to reconnect if disconnected
  });

  const name = `Bot ${index}`;
  let isAlive = false;

  socket.on('connect', () => {
    socket.emit('join', name, (res) => {
      if (res.ok) {
        isAlive = true;
        console.log(`[+] ${name} joined!`);
      } else {
        console.log(`[!] ${name} failed to join: ${res.reason}`);
      }
    });
  });
  
  let currentSequence = [];
  socket.on('show-sequence', (data) => {
    currentSequence = data.sequence;
  });

  socket.on('your-turn', (data) => {
    if (!isAlive) return;
    
    // We must tap currentSequence.length times
    let progress = 0;
    
    function tapNext() {
      if (!isAlive || progress >= currentSequence.length) return;
      
      const willMakeMistake = Math.random() < 0.05; // 5% chance of mistake per tap
      let colorToTap = currentSequence[progress];
      
      if (willMakeMistake) {
        const colors = ['red', 'blue', 'green', 'yellow'];
        const wrongColors = colors.filter(c => c !== colorToTap);
        colorToTap = wrongColors[Math.floor(Math.random() * wrongColors.length)];
      }
      
      socket.emit('player:tap', colorToTap);
      progress++;
      
      if (!willMakeMistake && progress < currentSequence.length) {
        setTimeout(tapNext, 300 + Math.random() * 500); // Wait a bit between taps
      }
    }
    
    // Start tapping after a short delay
    setTimeout(tapNext, 500 + Math.random() * 2000);
  });

  socket.on('eliminated', () => {
    isAlive = false;
    console.log(`💀 ${name} was eliminated.`);
  });

  socket.on('round-survived', () => {
    console.log(`✅ ${name} survived.`);
  });

  socket.on('force-reset', () => {
    console.log(`🔄 ${name} received force reset.`);
    isAlive = false;
  });

  socket.on('disconnect', () => {
    isAlive = false;
  });

  return socket;
}

// Stagger connections slightly
for (let i = 1; i <= NUM_BOTS; i++) {
  setTimeout(() => {
    bots.push(createBot(i));
  }, i * 50); // 50ms between each bot connecting
}

// Handle exit
process.on('SIGINT', () => {
  console.log('🛑 Shutting down bots...');
  bots.forEach(b => b.disconnect());
  process.exit();
});
