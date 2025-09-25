const WebSocket = require('ws');

console.log("=== TEST 3: WebSocket Connection ===");
const ws = new WebSocket('ws://localhost:3335/ws');

ws.on('open', () => {
  console.log('✅ WebSocket connected successfully!');
  
  // Test subscribe
  ws.send(JSON.stringify({ type: 'subscribe', data: { channel: 'incidents' }}));
  
  // Test ping
  ws.send(JSON.stringify({ type: 'ping' }));
  
  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 2000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📨 Received:', msg.type, msg.message || '');
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('Timeout reached');
  process.exit(0);
}, 3000);
