const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 100;

// ==========================================
// 1. HTTP Server for 3D Client & Static Audio Assets
// ==========================================
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];

  if (reqPath === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }

  if (reqPath === '/' || reqPath.endsWith('.html')) {
    const htmlFile = reqPath === '/' ? 'index.html' : path.basename(reqPath);
    const filePath = path.join(__dirname, '..', 'public', htmlFile);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('Error loading client page.');
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(data);
    });
  } else if (reqPath.startsWith('/audio/')) {
    const fileName = path.basename(reqPath);
    const audioPath = path.join(__dirname, '..', 'public', 'audio', fileName);

    fs.stat(audioPath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404);
        return res.end('Audio Not Found');
      }

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(audioPath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'audio/mpeg'
        });
        file.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stats.size,
          'Content-Type': 'audio/mpeg',
          'Accept-Ranges': 'bytes'
        });
        fs.createReadStream(audioPath).pipe(res);
      }
    });
  } else if (reqPath.endsWith('.js')) {
    const jsPath = path.join(__dirname, '..', 'public', path.basename(reqPath));
    fs.stat(jsPath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404);
        return res.end('JS Not Found');
      }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': stats.size,
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(jsPath).pipe(res);
    });
  } else if (reqPath.endsWith('.glb') || reqPath.endsWith('.gltf') || reqPath.endsWith('.bin')) {
    const modelPath = path.join(__dirname, '..', 'public', path.basename(reqPath));
    fs.stat(modelPath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404);
        return res.end('3D Model Not Found');
      }
      res.writeHead(200, {
        'Content-Type': 'model/gltf-binary',
        'Content-Length': stats.size,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      fs.createReadStream(modelPath).pipe(res);
    });
  } else if (reqPath.endsWith('.jpg') || reqPath.endsWith('.jpeg') || reqPath.endsWith('.png') || reqPath.endsWith('.webp')) {
    const imgPath = path.join(__dirname, '..', 'public', path.basename(reqPath));
    fs.stat(imgPath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404);
        return res.end('Image Not Found');
      }
      const ext = path.extname(imgPath).toLowerCase();
      const contentType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Cache-Control': 'public, max-age=86400'
      });
      fs.createReadStream(imgPath).pipe(res);
    });
  } else if (reqPath === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      activeRooms: roomManager.getRoomsSummary(),
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// ==========================================
// 2. 3D Room & Zen State Manager
// ==========================================
class TempleRoom3D {
  constructor(id, name, capacity = MAX_PLAYERS_PER_ROOM) {
    this.id = id;
    this.name = name;
    this.capacity = capacity;
    this.players = new Map();
    
    // Bố trí 100 bồ đoàn theo phong cách chùa truyền thống:
    // 2 cánh (Tả & Hữu), mỗi bên 5 cột x 10 hàng = 50 chỗ, ở giữa là lối đi Thảm Đỏ trang nghiêm
    this.seats = [];
    const rows = 10;
    const colsPerSide = 5;
    const spacingX = 2.6;
    const spacingZ = 2.3;
    const aisleWidth = 4.2; // Lối đi thảm đỏ giữa chánh điện
    const startZ = -1.5;

    let seatId = 0;
    for (let r = 0; r < rows; r++) {
      // Cánh Tả (Bên Trái) - 5 bồ đoàn
      for (let c = 0; c < colsPerSide; c++) {
        const x = -((aisleWidth / 2) + (colsPerSide - 1 - c) * spacingX + 0.8);
        const z = startZ + r * spacingZ;
        this.seats.push({
          seatId: seatId++,
          side: 'left',
          x: Number(x.toFixed(2)),
          y: 0.15,
          z: Number(z.toFixed(2)),
          occupant: null
        });
      }

      // Cánh Hữu (Bên Phải) - 5 bồ đoàn
      for (let c = 0; c < colsPerSide; c++) {
        const x = (aisleWidth / 2) + c * spacingX + 0.8;
        const z = startZ + r * spacingZ;
        this.seats.push({
          seatId: seatId++,
          side: 'right',
          x: Number(x.toFixed(2)),
          y: 0.15,
          z: Number(z.toFixed(2)),
          occupant: null
        });
      }
    }

    this.incenseBurningUntil = 0;
    this.lastBellStrike = 0;
    this.totalMerits = 0;
    this.lanterns = [];
  }

  join(ws, playerInfo) {
    const playerId = playerInfo.id || 'p_' + Math.random().toString(36).substring(2, 9);
    // Xuất phát ở cửa chánh điện trên thảm đỏ (Z = 23, X = 0)
    const spawnX = Number(((Math.random() - 0.5) * 2.0).toFixed(2));
    const spawnZ = 23.5;

    const player = {
      id: playerId,
      nickname: playerInfo.nickname || `Chú Tiểu #${Math.floor(100 + Math.random() * 900)}`,
      avatar: playerInfo.avatar || 'monk_apprentice',
      robeColor: typeof playerInfo.robeColor === 'number' ? playerInfo.robeColor : 0x7a3f20,
      x: spawnX,
      y: 0.0,
      z: spawnZ,
      rotY: Math.PI, // Quay mặt nhìn lên Phật đài
      isMoving: false,
      isSitting: false,
      seatId: null,
      meritPoints: 0,
      beadCount: 0,
      fishHits: 0,
      lastMoveTime: 0,
      ws: ws
    };

    this.players.set(ws, player);
    return player;
  }

  leave(ws) {
    const player = this.players.get(ws);
    if (!player) return null;

    if (player.seatId !== null) {
      this.vacateSeat(player.seatId, player.id);
    }
    this.players.delete(ws);
    return player;
  }

  claimSeat(playerId, seatId) {
    if (seatId < 0 || seatId >= this.capacity) return { success: false, reason: 'Bồ đoàn không tồn tại' };

    const targetSeat = this.seats[seatId];
    if (targetSeat.occupant && targetSeat.occupant.playerId !== playerId) {
      return { success: false, reason: 'Bồ đoàn này đã có đồng tu khác an vị' };
    }

    const player = this.findPlayerById(playerId);
    if (!player) return { success: false, reason: 'Không tìm thấy người chơi' };

    if (player.seatId !== null && player.seatId !== seatId) {
      this.seats[player.seatId].occupant = null;
    }

    targetSeat.occupant = {
      playerId: player.id,
      nickname: player.nickname,
      avatar: player.avatar
    };
    player.seatId = seatId;
    player.isSitting = true;
    player.x = targetSeat.x;
    player.y = 0.25;
    player.z = targetSeat.z;
    player.rotY = Math.PI; // Hướng mặt về Đức Phật

    return { success: true, seat: targetSeat };
  }

  vacateSeat(seatId, playerId) {
    if (seatId >= 0 && seatId < this.capacity) {
      const seat = this.seats[seatId];
      if (seat.occupant && seat.occupant.playerId === playerId) {
        seat.occupant = null;
      }
    }
    const player = this.findPlayerById(playerId);
    if (player) {
      player.seatId = null;
      player.isSitting = false;
      player.y = 0.0;
    }
  }

  findPlayerById(playerId) {
    for (const p of this.players.values()) {
      if (p.id === playerId) return p;
    }
    return null;
  }

  broadcast(messageObj, excludeWs = null) {
    const payload = JSON.stringify(messageObj);
    for (const [clientWs] of this.players.entries()) {
      if (clientWs !== excludeWs && clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.send(payload);
        } catch (e) {
          // Socket write failed, ignore to keep other clients stable
        }
      }
    }
  }

  getPublicRoomState() {
    const playerList = [];
    for (const p of this.players.values()) {
      playerList.push({
        id: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        robeColor: p.robeColor || 0x7a3f20,
        x: p.x,
        y: p.y,
        z: p.z,
        rotY: p.rotY,
        isSitting: p.isSitting,
        seatId: p.seatId,
        meritPoints: p.meritPoints
      });
    }

    return {
      roomId: this.id,
      roomName: this.name,
      onlineCount: this.players.size,
      capacity: this.capacity,
      seats: this.seats,
      players: playerList,
      totalMerits: this.totalMerits,
      incenseActive: Date.now() < this.incenseBurningUntil,
      lanterns: this.lanterns
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    const defaultRoom = new TempleRoom3D('zen_room_01', 'Đại Bi Thiền Tự 3D - 100 Chú Tiểu Đồng Quy', 100);
    this.rooms.set(defaultRoom.id, defaultRoom);
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomsSummary() {
    const list = [];
    for (const room of this.rooms.values()) {
      list.push({
        id: room.id,
        name: room.name,
        online: room.players.size,
        capacity: room.capacity
      });
    }
    return list;
  }
}

const roomManager = new RoomManager();

// ==========================================
// 3. WebSocket 3D Network Layer
// ==========================================
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let currentRoom = null;
  let player = null;
  let rateLimiter = { lastTime: 0, count: 0 };

  const checkRateLimit = (maxPerSec = 15) => {
    const now = Date.now();
    if (now - rateLimiter.lastTime > 1000) {
      rateLimiter.lastTime = now;
      rateLimiter.count = 1;
      return true;
    }
    rateLimiter.count++;
    return rateLimiter.count <= maxPerSec;
  };

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'JOIN_ROOM': {
          const roomId = msg.roomId || 'zen_room_01';
          const room = roomManager.getRoom(roomId);
          if (!room) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Phòng không tồn tại' }));
          if (room.players.size >= room.capacity) {
            return ws.send(JSON.stringify({ type: 'ERROR', message: 'Thiền đường đã đủ 100 người' }));
          }

          currentRoom = room;
          player = room.join(ws, {
            nickname: msg.nickname,
            avatar: msg.avatar,
            robeColor: msg.robeColor
          });

          ws.send(JSON.stringify({
            type: 'ROOM_JOINED',
            playerId: player.id,
            player: {
              id: player.id,
              nickname: player.nickname,
              avatar: player.avatar,
              robeColor: player.robeColor,
              x: player.x,
              y: player.y,
              z: player.z,
              rotY: player.rotY,
              seatId: player.seatId,
              meritPoints: player.meritPoints
            },
            room: {
              id: room.id,
              seats: room.seats,
              onlineCount: room.players.size
            },
            roomState: room.getPublicRoomState()
          }));

          room.broadcast({
            type: 'PLAYER_ENTERED',
            player: {
              id: player.id,
              nickname: player.nickname,
              avatar: player.avatar,
              robeColor: player.robeColor,
              x: player.x,
              y: player.y,
              z: player.z,
              rotY: player.rotY,
              isSitting: false,
              meritPoints: player.meritPoints
            },
            onlineCount: room.players.size
          }, ws);
          break;
        }

        case 'PING': {
          try {
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
          } catch (e) {}
          break;
        }

        case 'PLAYER_MOVE': {
          if (!currentRoom || !player || player.isSitting) return;

          const now = Date.now();
          if (now - player.lastMoveTime < 45) return;
          player.lastMoveTime = now;

          const px = Number(msg.x);
          const py = Number(msg.y);
          const pz = Number(msg.z);
          const rot = Number(msg.rotY);

          if (!isNaN(px) && !isNaN(py) && !isNaN(pz) && !isNaN(rot)) {
            player.x = Math.max(-21, Math.min(21, px));
            player.y = Math.max(0, Math.min(10, py));
            player.z = Math.max(-20, Math.min(54, pz));
            player.rotY = rot;
            player.isMoving = !!msg.isMoving;
          }

          currentRoom.broadcast({
            type: 'PLAYER_MOVED',
            id: player.id,
            x: player.x,
            y: player.y,
            z: player.z,
            rotY: player.rotY,
            isMoving: player.isMoving
          }, ws);
          break;
        }

        case 'CHOOSE_SEAT': {
          if (!currentRoom || !player) return;
          const result = currentRoom.claimSeat(player.id, msg.seatId);
          if (result.success) {
            currentRoom.broadcast({
              type: 'SEAT_UPDATED',
              seatId: msg.seatId,
              occupant: {
                playerId: player.id,
                nickname: player.nickname,
                avatar: player.avatar
              },
              playerPos: {
                x: result.seat.x,
                y: result.seat.y,
                z: result.seat.z,
                rotY: player.rotY
              }
            });
          } else {
            ws.send(JSON.stringify({ type: 'ERROR', message: result.reason }));
          }
          break;
        }

        case 'LEAVE_SEAT': {
          if (!currentRoom || !player || player.seatId === null) return;
          const oldSeat = player.seatId;
          currentRoom.vacateSeat(oldSeat, player.id);
          currentRoom.broadcast({
            type: 'SEAT_UPDATED',
            seatId: oldSeat,
            occupant: null,
            playerPos: {
              x: player.x,
              y: 0.0,
              z: player.z + 0.8,
              rotY: player.rotY
            }
          });
          break;
        }

        case 'STRIKE_WOODEN_FISH': {
          if (!currentRoom || !player) return;
          if (!checkRateLimit(12)) {
            return ws.send(JSON.stringify({ type: 'WARN', message: 'Tâm tịnh, chớ gõ mõ quá nhanh!' }));
          }

          player.fishHits++;
          player.meritPoints += 1;
          currentRoom.totalMerits += 1;

          currentRoom.broadcast({
            type: 'SOUND_WOODEN_FISH',
            playerId: player.id,
            nickname: player.nickname,
            x: player.x,
            z: player.z,
            merits: player.meritPoints,
            roomTotalMerits: currentRoom.totalMerits
          });
          break;
        }

        case 'STRIKE_BELL': {
          if (!currentRoom || !player) return;
          const now = Date.now();
          if (now - currentRoom.lastBellStrike < 3000) {
            return ws.send(JSON.stringify({ type: 'WARN', message: 'Chuông vừa thỉnh, hãy để âm thanh ngân tịnh.' }));
          }

          currentRoom.lastBellStrike = now;
          player.meritPoints += 5;
          currentRoom.totalMerits += 5;

          currentRoom.broadcast({
            type: 'SOUND_BELL',
            playerId: player.id,
            nickname: player.nickname,
            x: player.x,
            z: player.z,
            merits: player.meritPoints,
            roomTotalMerits: currentRoom.totalMerits
          });
          break;
        }

        case 'COUNT_BEAD': {
          if (!currentRoom || !player) return;
          if (!checkRateLimit(10)) return;

          player.beadCount = (player.beadCount + 1) % 108;
          player.meritPoints += 1;
          currentRoom.totalMerits += 1;

          ws.send(JSON.stringify({
            type: 'BEAD_UPDATED',
            beadCount: player.beadCount,
            meritPoints: player.meritPoints,
            completedRound: player.beadCount === 0
          }));
          break;
        }

        case 'LIGHT_INCENSE': {
          if (!currentRoom || !player) return;
          currentRoom.incenseBurningUntil = Date.now() + 5 * 60 * 1000;
          currentRoom.totalMerits += 10;
          player.meritPoints += 10;

          currentRoom.broadcast({
            type: 'INCENSE_LIT',
            by: player.nickname,
            burnUntil: currentRoom.incenseBurningUntil,
            roomTotalMerits: currentRoom.totalMerits
          });
          break;
        }

        case 'STRIKE_BOWL': {
          if (!currentRoom || !player) return;
          if (!checkRateLimit(12)) return;

          player.meritPoints += 3;
          currentRoom.totalMerits += 3;

          currentRoom.broadcast({
            type: 'SOUND_BOWL',
            playerId: player.id,
            nickname: player.nickname,
            x: player.x,
            z: player.z,
            merits: player.meritPoints,
            roomTotalMerits: currentRoom.totalMerits
          });
          break;
        }

        case 'CHANGE_ROBE': {
          if (!currentRoom || !player) return;
          const color = typeof msg.robeColor === 'number' ? msg.robeColor : 0x7a3f20;
          player.robeColor = color;

          currentRoom.broadcast({
            type: 'ROBE_CHANGED',
            playerId: player.id,
            robeColor: color
          });
          break;
        }

        case 'CHANGE_NICKNAME': {
          if (!currentRoom || !player) return;
          const newName = typeof msg.nickname === 'string' ? msg.nickname.trim().substring(0, 30) : '';
          if (!newName) return;
          player.nickname = newName;

          currentRoom.broadcast({
            type: 'NICKNAME_CHANGED',
            playerId: player.id,
            nickname: player.nickname
          });
          break;
        }

        case 'PLAYER_BOW': {
          if (!currentRoom || !player) return;
          currentRoom.broadcast({
            type: 'PLAYER_BOWED',
            playerId: player.id
          }, ws);
          break;
        }

        case 'SEND_ZEN_CHAT': {
          if (!currentRoom || !player) return;
          if (!checkRateLimit(10)) return;

          const text = typeof msg.text === 'string' ? msg.text.trim().substring(0, 100) : '';
          if (!text) return;

          player.meritPoints += 1;
          currentRoom.totalMerits += 1;

          currentRoom.broadcast({
            type: 'ZEN_CHAT_BUBBLE',
            playerId: player.id,
            nickname: player.nickname,
            text: text,
            merits: player.meritPoints,
            roomTotalMerits: currentRoom.totalMerits
          });
          break;
        }

        case 'RELEASE_LANTERN': {
          if (!currentRoom || !player) return;
          const lantern = {
            id: 'lantern_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            playerId: player.id,
            nickname: player.nickname,
            wish: String(msg.wish || 'Cầu chúc muôn người bình an, vạn sự cát tường').substring(0, 160),
            color: msg.color || 'pink',
            x: typeof msg.x === 'number' ? Number(msg.x.toFixed(2)) : 0,
            z: typeof msg.z === 'number' ? Number(msg.z.toFixed(2)) : 42,
            createdAt: Date.now()
          };
          currentRoom.lanterns.push(lantern);
          if (currentRoom.lanterns.length > 60) currentRoom.lanterns.shift();
          currentRoom.totalMerits += 10;
          player.meritPoints += 10;

          currentRoom.broadcast({
            type: 'LANTERN_RELEASED',
            lantern: lantern,
            playerId: player.id,
            merits: player.meritPoints,
            roomTotalMerits: currentRoom.totalMerits
          });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoom && player) {
      const leftPlayer = currentRoom.leave(ws);
      if (leftPlayer) {
        currentRoom.broadcast({
          type: 'PLAYER_LEFT',
          playerId: leftPlayer.id,
          seatId: leftPlayer.seatId,
          onlineCount: currentRoom.players.size
        });
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket client error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`[3D ZEN SERVER V2] Đang hoạt động tại: http://localhost:${PORT}`);
});
