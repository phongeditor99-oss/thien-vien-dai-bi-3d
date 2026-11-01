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
  } else if (reqPath === '/api/sutra-schedule') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(getScheduledSutraInfo()));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// ==========================================
// THỜI KHÓA TỤNG KINH 19H HÀNG NGÀY (GIỜ VIỆT NAM - UTC+7)
// ==========================================
const WEEKLY_SUTRA_SCHEDULE = {
  1: { // Thứ Hai
    dayIndex: 1,
    dayName: 'Thứ Hai',
    sutraId: 'sutra_mon',
    title: 'Trì Tụng Chú Đại Bi & Niệm Bồ Tát Quán Thế Âm',
    subTitle: 'Khóa Lễ Đầu Tuần (22 phút) - Lòng Từ Bi che chở, cầu an lành vạn sự',
    url: '/audio/sutra_mon_dai_bi.mp3',
    durationMinutes: 22.4,
    durationSec: 1342,
    merits: 30
  },
  2: { // Thứ Ba
    dayIndex: 2,
    dayName: 'Thứ Ba',
    sutraId: 'sutra_tue',
    title: 'Kinh Dược Sư Lưu Ly Quang Vương Như Lai',
    subTitle: 'Khóa Lễ Cầu An (82 phút) - Tiêu trừ tật bệnh, thân tâm an lạc',
    url: '/audio/sutra_tue_duoc_su.mp3',
    durationMinutes: 82.5,
    durationSec: 4950,
    merits: 35
  },
  3: { // Thứ Tư
    dayIndex: 3,
    dayName: 'Thứ Tư',
    sutraId: 'sutra_wed',
    title: 'Kinh Bát Nhã Ba La Mật Đa (7 Biến)',
    subTitle: 'Khóa Lễ Trí Tuệ (24 phút) - Phá vô minh phiền não, khai mở giác ngộ',
    url: '/audio/sutra_wed_bat_nha.mp3',
    durationMinutes: 24.1,
    durationSec: 1448,
    merits: 25
  },
  4: { // Thứ Năm
    dayIndex: 4,
    dayName: 'Thứ Năm',
    sutraId: 'sutra_thu',
    title: 'Kinh Diệu Pháp Liên Hoa - Phẩm Phổ Môn',
    subTitle: 'Khóa Lễ Cứu Khổ (48 phút) - Linh ứng tầm thinh cứu khổ cứu nạn',
    url: '/audio/sutra_thu_pho_mon.mp3',
    durationMinutes: 48.2,
    durationSec: 2892,
    merits: 30
  },
  5: { // Thứ Sáu
    dayIndex: 5,
    dayName: 'Thứ Sáu',
    sutraId: 'sutra_fri',
    title: 'Kinh Địa Tạng Bồ Tát Bổn Nguyện (Trọn Bộ)',
    subTitle: 'Khóa Lễ Báo Hiếu (3.8 giờ) - Hồi hướng cửu huyền thất tổ, siêu tiến độ sanh',
    url: '/audio/sutra_fri_dia_tang.mp3',
    durationMinutes: 232.1,
    durationSec: 13926,
    merits: 50
  },
  6: { // Thứ Bảy
    dayIndex: 6,
    dayName: 'Thứ Bảy',
    sutraId: 'sutra_sat',
    title: 'Kinh Phật Thuyết A Di Đà',
    subTitle: 'Khóa Lễ Tịnh Độ Cuối Tuần (70 phút) - Gieo duyên Tịnh Độ Cực Lạc Tây Phương',
    url: '/audio/sutra_sat_a_di_da.mp3',
    durationMinutes: 70.1,
    durationSec: 4206,
    merits: 35
  },
  0: { // Chủ Nhật
    dayIndex: 0,
    dayName: 'Chủ Nhật',
    sutraId: 'sutra_sun',
    title: 'Kinh Phật Thuyết Đại Thừa Vô Lượng Thọ Trang Nghiêm',
    subTitle: 'Khóa Lễ Đại Hoan Hỷ (2.1 giờ) - Viên mãn tuần tu tập, phước huệ trang nghiêm',
    url: '/audio/sutra_sun_vo_luong_tho.mp3',
    durationMinutes: 128.6,
    durationSec: 7716,
    merits: 50
  }
};

function getVietnamDate() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 7 * 3600000); // UTC+7 (Giờ Việt Nam)
}

function getScheduledSutraInfo() {
  const vnDate = getVietnamDate();
  const day = vnDate.getDay();
  const sutra = WEEKLY_SUTRA_SCHEDULE[day];
  const hours = vnDate.getHours();
  const minutes = vnDate.getMinutes();
  const seconds = vnDate.getSeconds();
  const currentSec = hours * 3600 + minutes * 60 + seconds;
  const startSec = 19 * 3600; // 19:00:00 = 68400s
  const endSec = startSec + sutra.durationSec;
  
  const isRecitingNow = (currentSec >= startSec && currentSec < endSec);
  const elapsedSeconds = isRecitingNow ? (currentSec - startSec) : 0;
  
  return {
    dayOfWeek: day,
    dayName: sutra.dayName,
    sutra: sutra,
    isRecitingNow: isRecitingNow,
    elapsedSeconds: elapsedSeconds,
    elapsedSec: elapsedSeconds,
    scheduleTimeStr: '19:00:00 (Hàng Ngày - Giờ Việt Nam GMT+7)',
    currentVnTimeStr: `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`,
    scheduleList: WEEKLY_SUTRA_SCHEDULE
  };
}

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
    // Xuất phát ở cửa chánh điện trên thảm đỏ (Z = 22.0, X = 0) hoặc khôi phục vị trí khi kết nối lại
    const defaultSpawnX = Number(((Math.random() - 0.5) * 2.0).toFixed(2));
    const defaultSpawnZ = 22.0;

    const hasReconnectPos = typeof playerInfo.x === 'number' && typeof playerInfo.z === 'number' && !isNaN(playerInfo.x) && !isNaN(playerInfo.z);
    const initX = hasReconnectPos ? Math.max(-25, Math.min(25, Number(playerInfo.x))) : defaultSpawnX;
    const initY = (typeof playerInfo.y === 'number' && !isNaN(playerInfo.y)) ? Math.max(0, Math.min(10, Number(playerInfo.y))) : 0.0;
    const initZ = hasReconnectPos ? Math.max(-19, Math.min(62, Number(playerInfo.z))) : defaultSpawnZ;
    const initRotY = (typeof playerInfo.rotY === 'number' && !isNaN(playerInfo.rotY)) ? Number(playerInfo.rotY) : Math.PI;

    const savedMerits = Number.isFinite(Number(playerInfo.meritPoints))
      ? Math.max(0, Math.min(999999, Math.floor(Number(playerInfo.meritPoints))))
      : 0;
    const savedBeads = Number.isFinite(Number(playerInfo.beadCount))
      ? Math.max(0, Math.min(107, Math.floor(Number(playerInfo.beadCount))))
      : 0;

    const player = {
      id: playerId,
      nickname: playerInfo.nickname || `Chú Tiểu #${Math.floor(100 + Math.random() * 900)}`,
      avatar: playerInfo.avatar || 'monk_apprentice',
      robeColor: typeof playerInfo.robeColor === 'number' ? playerInfo.robeColor : 0x7a3f20,
      x: initX,
      y: initY,
      z: initZ,
      rotY: initRotY, // Quay mặt nhìn lên Phật đài
      isMoving: false,
      isSitting: false,
      seatId: null,
      meritPoints: savedMerits,
      beadCount: savedBeads,
      fishHits: 0,
      lastMoveTime: 0,
      lastMeditateTick: Date.now(),
      blessedLanterns: new Set(),
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
    player.lastMeditateTick = Date.now();
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
      lanterns: this.lanterns,
      scheduledSutra: getScheduledSutraInfo()
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
            robeColor: msg.robeColor,
            meritPoints: msg.meritPoints,
            beadCount: msg.beadCount,
            x: msg.x,
            y: msg.y,
            z: msg.z,
            rotY: msg.rotY
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
              meritPoints: player.meritPoints,
              beadCount: player.beadCount
            },
            room: {
              id: room.id,
              seats: room.seats,
              onlineCount: room.players.size,
              roomTotalMerits: room.totalMerits
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
            player.x = Math.max(-25.0, Math.min(25.0, px));
            player.y = Math.max(0, Math.min(10, py));
            player.z = Math.max(-19.0, Math.min(62.0, pz));
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

        case 'MEDITATE_TICK': {
          if (!currentRoom || !player || !player.isSitting) return;
          const now = Date.now();
          if (now - (player.lastMeditateTick || 0) < 25000) return;
          player.lastMeditateTick = now;
          player.meritPoints += 2;
          currentRoom.totalMerits += 2;

          ws.send(JSON.stringify({
            type: 'MERIT_UPDATED',
            playerId: player.id,
            merits: player.meritPoints,
            delta: 2,
            reason: 'meditate',
            roomTotalMerits: currentRoom.totalMerits
          }));

          currentRoom.broadcast({
            type: 'PLAYER_MERIT_SYNC',
            playerId: player.id,
            merits: player.meritPoints,
            roomTotalMerits: currentRoom.totalMerits
          }, ws);
          break;
        }

        case 'BLESS_LANTERN': {
          if (!currentRoom || !player) return;
          if (!checkRateLimit(5)) return;
          const lanternId = String(msg.lanternId || '').substring(0, 80);
          if (!lanternId) return;
          if (player.blessedLanterns && player.blessedLanterns.has(lanternId)) {
            return ws.send(JSON.stringify({ type: 'WARN', message: 'Bạn đã tùy hỷ cầu an cho hoa đăng này rồi 🙏' }));
          }
          if (player.blessedLanterns) {
            player.blessedLanterns.add(lanternId);
            if (player.blessedLanterns.size > 120) {
              const firstKey = player.blessedLanterns.values().next().value;
              player.blessedLanterns.delete(firstKey);
            }
          }

          player.meritPoints += 1;
          currentRoom.totalMerits += 1;

          ws.send(JSON.stringify({
            type: 'MERIT_UPDATED',
            playerId: player.id,
            merits: player.meritPoints,
            delta: 1,
            reason: 'bless_lantern',
            lanternId: lanternId,
            roomTotalMerits: currentRoom.totalMerits
          }));

          currentRoom.broadcast({
            type: 'PLAYER_MERIT_SYNC',
            playerId: player.id,
            merits: player.meritPoints,
            roomTotalMerits: currentRoom.totalMerits
          }, ws);
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

// ==========================================
// ĐỒNG HỒ TỰ ĐỘNG KHỞI ĐỘNG KHÓA LỄ TỤNG KINH 19H HÀNG NGÀY
// ==========================================
let lastBroadcastSutraDay = -1;
setInterval(() => {
  const vnDate = getVietnamDate();
  const hours = vnDate.getHours();
  const minutes = vnDate.getMinutes();
  const day = vnDate.getDay();

  // Khởi động chính xác vào khung giờ 19:00 hàng ngày (Giờ Việt Nam)
  if (hours === 19 && minutes === 0 && lastBroadcastSutraDay !== day) {
    lastBroadcastSutraDay = day;
    const sutra = WEEKLY_SUTRA_SCHEDULE[day];
    console.log(`[KHÓA LỄ 19H] Khởi động khóa tụng kinh hôm nay (${sutra.dayName}): ${sutra.title}`);

    for (const room of roomManager.rooms.values()) {
      room.totalMerits += 50;
      room.broadcast({
        type: 'SCHEDULED_SUTRA_START',
        sutra: sutra,
        dayOfWeek: day,
        dayName: sutra.dayName,
        elapsedSeconds: 0,
        elapsedSec: 0,
        message: `🔔 ĐÃ ĐẾN 19:00 (GIỜ VIỆT NAM) - Đại chúng đồng quy khóa tụng ${sutra.title} 🙏 (+50 Công Đức)`
      });
    }
  }

  // Reset cờ phát sóng khi qua khỏi 19:00 để sẵn sàng cho ngày kế tiếp
  if (hours !== 19 && lastBroadcastSutraDay === day) {
    lastBroadcastSutraDay = -1;
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`[3D ZEN SERVER V2] Đang hoạt động tại: http://localhost:${PORT}`);
});
