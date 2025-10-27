// server.js
const path = require('path');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');

const io = new Server(http, { cors: { origin: '*' } });

// Serve static files từ thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// 1 phòng cố định 'lobby'
const rooms = { lobby: new Set() };

io.on('connection', (socket) => {
  // Client yêu cầu join phòng
  socket.on('join', (roomName = 'lobby', displayName = '') => {
    if (!rooms[roomName]) rooms[roomName] = new Set();

    // Gửi danh sách peers đang có cho người mới
    const peers = Array.from(rooms[roomName]);
    socket.emit('peers', peers);

    // Vào phòng
    socket.join(roomName);
    rooms[roomName].add(socket.id);

    // Lưu metadata
    socket.data.roomName = roomName;
    socket.data.displayName = displayName || `User-${socket.id.slice(0, 4)}`;

    // Báo cho mọi người biết có người mới
    socket.to(roomName).emit('peer-joined', socket.id, socket.data.displayName);
  });

  // Truyền tín hiệu WebRTC (offer/answer/ice)
  socket.on('signal', ({ to, type, data }) => {
    io.to(to).emit('signal', { from: socket.id, type, data });
  });

  // Rời phòng / disconnect
  socket.on('disconnect', () => {
    const roomName = socket.data.roomName || 'lobby';
    if (rooms[roomName]) {
      rooms[roomName].delete(socket.id);
      socket.to(roomName).emit('peer-left', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
