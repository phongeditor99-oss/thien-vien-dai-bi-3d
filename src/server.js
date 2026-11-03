const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 100;
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'temple_state.json');

function makeWeakETag(stats) {
  return `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
}

function serveCachedStaticFile(req, res, filePath, contentType, cacheControl) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const etag = makeWeakETag(stats);
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': cacheControl
      });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'ETag': etag,
      'Last-Modified': stats.mtime.toUTCString(),
      'Cache-Control': cacheControl
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ==========================================
// 1. HTTP Server for 3D Client & Static Audio Assets (Smart ETag + Gzip Cache)
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
    fs.stat(filePath, (statErr, stats) => {
      if (statErr || !stats.isFile()) {
        res.writeHead(500);
        return res.end('Error loading client page.');
      }
      const etag = makeWeakETag(stats);
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, {
          'ETag': etag,
          'Cache-Control': 'no-cache'
        });
        return res.end();
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500);
          return res.end('Error loading client page.');
        }
        const acceptEncoding = req.headers['accept-encoding'] || '';
        if (acceptEncoding.includes('gzip')) {
          zlib.gzip(data, (gzErr, compressed) => {
            if (gzErr) {
              res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'ETag': etag,
                'Cache-Control': 'no-cache'
              });
              return res.end(data);
            }
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Content-Encoding': 'gzip',
              'Vary': 'Accept-Encoding',
              'Content-Length': compressed.length,
              'ETag': etag,
              'Cache-Control': 'no-cache'
            });
            res.end(compressed);
          });
        } else {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': data.length,
            'ETag': etag,
            'Cache-Control': 'no-cache'
          });
          res.end(data);
        }
      });
    });
  } else if (reqPath.startsWith('/audio/')) {
    const fileName = path.basename(reqPath);
    // Chuyển hướng 302 toàn bộ yêu cầu âm thanh sang GitHub Global CDN để tiết kiệm 100% băng thông Render
    res.writeHead(302, {
      'Location': 'https://github.com/phongeditor99-oss/thien-vien-dai-bi-3d/releases/download/audio-assets-v1/' + fileName,
      'Cache-Control': 'public, max-age=86400'
    });
    return res.end();
  } else if (reqPath.endsWith('.js')) {
    const jsPath = path.join(__dirname, '..', 'public', path.basename(reqPath));
    serveCachedStaticFile(req, res, jsPath, 'application/javascript; charset=utf-8', 'public, max-age=604800, stale-while-revalidate=86400');
  } else if (reqPath.endsWith('.glb') || reqPath.endsWith('.gltf') || reqPath.endsWith('.bin')) {
    const modelPath = path.join(__dirname, '..', 'public', path.basename(reqPath));
    serveCachedStaticFile(req, res, modelPath, 'model/gltf-binary', 'public, max-age=604800, stale-while-revalidate=86400');
  } else if (reqPath.endsWith('.jpg') || reqPath.endsWith('.jpeg') || reqPath.endsWith('.png') || reqPath.endsWith('.webp')) {
    const imgPath = path.join(__dirname, '..', 'public', path.basename(reqPath));
    const ext = path.extname(imgPath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
    serveCachedStaticFile(req, res, imgPath, contentType, 'public, max-age=604800, stale-while-revalidate=86400');
  } else if (reqPath === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'online',
      activeRooms: roomManager.getRoomsSummary(),
      lunarInfo: getVietnamLunarInfo(),
      uptime: process.uptime()
    }));
  } else if (reqPath === '/api/sutra-schedule') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(getScheduledSutraInfo()));
  } else if (reqPath === '/api/lunar') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(getVietnamLunarInfo()));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// ==========================================
// THỜI KHÓA TỤNG KINH 19H HÀNG NGÀY (GIỜ VIỆT NAM - UTC+7)
// ==========================================
const CDN_AUDIO_BASE = 'https://github.com/phongeditor99-oss/thien-vien-dai-bi-3d/releases/download/audio-assets-v1/';

const WEEKLY_SUTRA_SCHEDULE = {
  1: { // Thứ Hai
    dayIndex: 1,
    dayName: 'Thứ Hai',
    sutraId: 'sutra_mon',
    title: 'Trì Tụng Chú Đại Bi & Niệm Bồ Tát Quán Thế Âm',
    subTitle: 'Khóa Lễ Đầu Tuần (22 phút) - Lòng Từ Bi che chở, cầu an lành vạn sự',
    url: CDN_AUDIO_BASE + 'sutra_mon_dai_bi.mp3',
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
    url: CDN_AUDIO_BASE + 'sutra_tue_duoc_su.mp3',
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
    url: CDN_AUDIO_BASE + 'sutra_wed_bat_nha.mp3',
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
    url: CDN_AUDIO_BASE + 'sutra_thu_pho_mon.mp3',
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
    url: CDN_AUDIO_BASE + 'sutra_fri_dia_tang.mp3',
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
    url: CDN_AUDIO_BASE + 'sutra_sat_a_di_da.mp3',
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
    url: CDN_AUDIO_BASE + 'sutra_sun_vo_luong_tho.mp3',
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

// ==========================================
// LỊCH ÂM VIỆT NAM TỰ ĐỘNG (THUẬT TOÁN THIÊN VĂN HỒ NGỌC ĐỨC - MÚI GIỜ +7)
// ==========================================
function jdFromDate(dd, mm, yy) {
  const a = Math.floor((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  if (jd < 2299161) {
    jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
  }
  return jd;
}

function getNewMoonDay(k, timeZone) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = Math.PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  let deltat;
  if (T < -11) {
    deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
  } else {
    deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
  }
  return Math.floor(Jd1 + C1 - deltat + 0.5 + timeZone / 24.0);
}

function getSunLongitude(jdn, timeZone) {
  const T = (jdn - 2451545.5 - timeZone / 24.0) / 36525.0;
  const T2 = T * T;
  const dr = Math.PI / 180;
  const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L = L - Math.PI * 2 * Math.floor(L / (Math.PI * 2));
  return Math.floor((L / Math.PI) * 6);
}

function getLunarMonth11(yy, timeZone) {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = Math.floor(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  if (getSunLongitude(nm, timeZone) >= 9) {
    nm = getNewMoonDay(k - 1, timeZone);
  }
  return nm;
}

function getLeapMonthOffset(a11, timeZone) {
  const k = Math.floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

function convertSolar2LunarVN(dd, mm, yy, timeZone = 7.0) {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = Math.floor((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) {
    monthStart = getNewMoonDay(k, timeZone);
  }
  let a11 = getLunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = Math.floor((monthStart - a11) / 29);
  let lunarLeap = 0;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) lunarLeap = 1;
    }
  }
  if (lunarMonth > 12) lunarMonth = lunarMonth - 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { day: lunarDay, month: lunarMonth, year: lunarYear, isLeap: lunarLeap === 1, jd: dayNumber };
}

const CAN_LIST = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI_LIST = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
const BUDDHIST_FESTIVALS = {
  '1-1': 'Tết Nguyên Đán • Vía Đức Phật Di Lặc',
  '15-1': 'Lễ Thượng Nguyên • Rằm Tháng Giêng',
  '8-2': 'Vía Đức Phật Thích Ca Xuất Gia',
  '15-2': 'Vía Đức Phật Thích Ca Nhập Niết Bàn',
  '19-2': 'Vía Đức Quán Thế Âm Bồ Tát Đản Sanh',
  '15-4': 'Đại Lễ Phật Đản (Vesak)',
  '19-6': 'Vía Đức Quán Thế Âm Bồ Tát Thành Đạo',
  '15-7': 'Đại Lễ Vu Lan Báo Hiếu',
  '30-7': 'Vía Đức Địa Tạng Vương Bồ Tát',
  '19-9': 'Vía Đức Quán Thế Âm Bồ Tát Xuất Gia',
  '17-11': 'Vía Đức Phật A Di Đà',
  '8-12': 'Vía Đức Phật Thích Ca Thành Đạo'
};

function getVietnamLunarInfo(customDate) {
  const vnDate = customDate || getVietnamDate();
  const sDay = vnDate.getDate();
  const sMonth = vnDate.getMonth() + 1;
  const sYear = vnDate.getFullYear();
  const lunar = convertSolar2LunarVN(sDay, sMonth, sYear, 7.0);

  const canChiYear = `${CAN_LIST[(lunar.year + 6) % 10]} ${CHI_LIST[(lunar.year + 8) % 12]}`;
  const canChiDay = `${CAN_LIST[(lunar.jd + 9) % 10]} ${CHI_LIST[(lunar.jd + 1) % 12]}`;
  const canChiMonth = `${CAN_LIST[(lunar.year * 12 + lunar.month + 3) % 10]} ${CHI_LIST[(lunar.month + 1) % 12]}`;

  const festKey = `${lunar.day}-${lunar.month}`;
  let festivalName = BUDDHIST_FESTIVALS[festKey] || null;
  const isMung1 = lunar.day === 1;
  const isRam = lunar.day === 15;
  const isTraiGioi = (lunar.day === 1 || lunar.day === 14 || lunar.day === 15 || lunar.day === 30);

  if (!festivalName) {
    if (isMung1) festivalName = 'Ngày Mùng 1 Đầu Tháng Âm Lịch (Trai Giới Cầu An)';
    else if (isRam) festivalName = 'Ngày Rằm 15 Âm Lịch (Lễ Phật Cầu Phúc)';
    else if (lunar.day === 14) festivalName = 'Ngày 14 Vọng Rằm (Tịnh Tâm Sám Hối)';
    else if (lunar.day === 30) festivalName = 'Ngày 30 Cuối Tháng (Tịnh Nghiệp Trai Giới)';
  }

  const isFestivalDay = Boolean(festivalName);
  const meritMultiplier = isFestivalDay ? 2 : 1;

  // Tìm số ngày còn lại tới Mùng 1 hoặc Ngày Rằm gần nhất
  let daysUntilNextFestival = 0;
  let nextFestivalLabel = festivalName || '';
  if (!isMung1 && !isRam) {
    for (let d = 1; d <= 31; d++) {
      const probe = new Date(vnDate.getTime() + d * 86400000);
      const pl = convertSolar2LunarVN(probe.getDate(), probe.getMonth() + 1, probe.getFullYear(), 7.0);
      const pk = `${pl.day}-${pl.month}`;
      if (pl.day === 1 || pl.day === 15 || BUDDHIST_FESTIVALS[pk]) {
        daysUntilNextFestival = d;
        nextFestivalLabel = BUDDHIST_FESTIVALS[pk] || (pl.day === 1 ? `Mùng 1/${pl.month} ÂL` : `Ngày Rằm 15/${pl.month} ÂL`);
        break;
      }
    }
  }

  const solarDateStr = `${String(sDay).padStart(2, '0')}/${String(sMonth).padStart(2, '0')}/${sYear}`;
  const lunarShort = `${lunar.day}/${lunar.month}${lunar.isLeap ? 'N' : ''} ÂL`;
  const dayPrefix = lunar.day <= 10 ? `Mùng ${lunar.day}` : (lunar.day === 15 ? 'Rằm 15' : `Ngày ${lunar.day}`);
  const lunarFullStr = `${dayPrefix} Tháng ${lunar.month}${lunar.isLeap ? ' Nhuận' : ''}`;

  return {
    solar: { day: sDay, month: sMonth, year: sYear },
    lunar: { day: lunar.day, month: lunar.month, year: lunar.year, isLeap: lunar.isLeap },
    lunarDay: lunar.day,
    lunarMonth: lunar.month,
    lunarYear: lunar.year,
    solarDateStr,
    lunarShort,
    lunarFullStr,
    canChiYear,
    canChiMonth,
    canChiDay,
    isMung1,
    isRam,
    isTraiGioi,
    isTraiGioiDay: isTraiGioi,
    isFestivalDay,
    festivalName,
    festivalTitle: festivalName,
    meritMultiplier,
    daysUntilNextFestival,
    nextFestivalLabel,
    nextMilestoneName: nextFestivalLabel || 'Ngày Rằm / Mùng 1'
  };
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
    lunarInfo: getVietnamLunarInfo(vnDate),
    scheduleList: WEEKLY_SUTRA_SCHEDULE
  };
}

const DEFAULT_WISHING_CARDS = [
  { id: 'wish_seed_1', nickname: 'Chú Tiểu Diệu Âm', category: 'suc_khoe', wish: 'Nguyện cầu cha mẹ hai bên luôn dồi dào sức khỏe, thân tâm thường an lạc.', blessCount: 12, slotIdx: 0, createdAt: Date.now() - 3600000 },
  { id: 'wish_seed_2', nickname: 'Phật Tử Liên Hoa', category: 'binh_an', wish: 'Cầu cho gia đạo thuận hòa, tai qua nạn khỏi, bốn mùa bình an cát tường.', blessCount: 9, slotIdx: 3, createdAt: Date.now() - 3000000 },
  { id: 'wish_seed_3', nickname: 'Chú Tiểu Tĩnh Tâm', category: 'tri_tue', wish: 'Nguyện giữ tâm chánh niệm sáng trong, bồ đề tâm kiên cố, lan tỏa từ bi.', blessCount: 15, slotIdx: 7, createdAt: Date.now() - 2400000 },
  { id: 'wish_seed_4', nickname: 'Thiện Nam Minh Đức', category: 'cong_danh', wish: 'Cầu cho công việc hanh thông, gặp nhiều thiện duyên lành, vạn sự như ý.', blessCount: 8, slotIdx: 11, createdAt: Date.now() - 1800000 },
  { id: 'wish_seed_5', nickname: 'Tín Nữ Tâm An', category: 'binh_an', wish: 'Nguyện khắp muôn loài vơi bớt khổ đau, nhà nhà ấm no hạnh phúc.', blessCount: 18, slotIdx: 15, createdAt: Date.now() - 1200000 },
  { id: 'wish_seed_6', nickname: 'Chú Tiểu Trí Tuệ', category: 'suc_khoe', wish: 'Kính chúc đại chúng đồng tu tinh tấn, phước huệ song tu, sở nguyện viên thành.', blessCount: 11, slotIdx: 19, createdAt: Date.now() - 600000 }
];

function loadPersistedTempleState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        totalMerits: Number(raw.totalMerits) || 108,
        lanterns: Array.isArray(raw.lanterns) ? raw.lanterns.slice(-60) : [],
        wishingCards: Array.isArray(raw.wishingCards) && raw.wishingCards.length > 0
          ? raw.wishingCards.slice(-48)
          : DEFAULT_WISHING_CARDS.slice()
      };
    }
  } catch (e) {
    console.warn('Could not load persisted temple_state.json:', e.message);
  }
  return {
    totalMerits: 108,
    lanterns: [],
    wishingCards: DEFAULT_WISHING_CARDS.slice()
  };
}

let saveStateTimer = null;
function scheduleSaveTempleState(room) {
  if (!room || saveStateTimer) return;
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const payload = JSON.stringify({
        totalMerits: room.totalMerits,
        lanterns: room.lanterns.slice(-60),
        wishingCards: room.wishingCards.slice(-48),
        updatedAt: new Date().toISOString()
      }, null, 2);
      fs.writeFile(STATE_FILE, payload, 'utf8', () => {});
    } catch (e) {
      console.warn('Could not save temple_state.json:', e.message);
    }
  }, 3500);
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

    const persisted = loadPersistedTempleState();
    this.incenseBurningUntil = 0;
    this.lastBellStrike = 0;
    this.totalMerits = persisted.totalMerits;
    this.lanterns = persisted.lanterns;
    this.wishingCards = persisted.wishingCards;
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
      blessedWishingCards: new Set(),
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
      wishingCards: this.wishingCards,
      lunarInfo: getVietnamLunarInfo(),
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

          const mult = getVietnamLunarInfo().meritMultiplier || 1;
          player.fishHits++;
          player.meritPoints += 1 * mult;
          currentRoom.totalMerits += 1 * mult;
          scheduleSaveTempleState(currentRoom);

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

          const mult = getVietnamLunarInfo().meritMultiplier || 1;
          currentRoom.lastBellStrike = now;
          player.meritPoints += 5 * mult;
          currentRoom.totalMerits += 5 * mult;
          scheduleSaveTempleState(currentRoom);

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

          const mult = getVietnamLunarInfo().meritMultiplier || 1;
          player.beadCount = (player.beadCount + 1) % 108;
          player.meritPoints += 1 * mult;
          currentRoom.totalMerits += 1 * mult;
          scheduleSaveTempleState(currentRoom);

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
          const mult = getVietnamLunarInfo().meritMultiplier || 1;
          currentRoom.incenseBurningUntil = Date.now() + 5 * 60 * 1000;
          currentRoom.totalMerits += 10 * mult;
          player.meritPoints += 10 * mult;
          scheduleSaveTempleState(currentRoom);

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

          const mult = getVietnamLunarInfo().meritMultiplier || 1;
          player.meritPoints += 3 * mult;
          currentRoom.totalMerits += 3 * mult;
          scheduleSaveTempleState(currentRoom);

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
          const mult = getVietnamLunarInfo().meritMultiplier || 1;
          const gain = 10 * mult;
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
          currentRoom.totalMerits += gain;
          player.meritPoints += gain;
          scheduleSaveTempleState(currentRoom);

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
          const mult = getVietnamLunarInfo().meritMultiplier || 1;
          const gain = 2 * mult;
          player.meritPoints += gain;
          currentRoom.totalMerits += gain;
          scheduleSaveTempleState(currentRoom);

          ws.send(JSON.stringify({
            type: 'MERIT_UPDATED',
            playerId: player.id,
            merits: player.meritPoints,
            delta: gain,
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

          const mult = getVietnamLunarInfo().meritMultiplier || 1;
          const gain = 1 * mult;
          player.meritPoints += gain;
          currentRoom.totalMerits += gain;
          scheduleSaveTempleState(currentRoom);

          ws.send(JSON.stringify({
            type: 'MERIT_UPDATED',
            playerId: player.id,
            merits: player.meritPoints,
            delta: gain,
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

        case 'HANG_WISHING_CARD': {
          if (!currentRoom || !player) return;
          if (!checkRateLimit(5)) return;
          const validCats = ['binh_an', 'suc_khoe', 'cong_danh', 'tri_tue'];
          const category = validCats.includes(msg.category) ? msg.category : 'binh_an';
          const wishText = String(msg.wish || 'Nguyện cầu gia đạo bình an, vạn sự cát tường như ý.').trim().substring(0, 160);
          if (!wishText) return;

          const mult = getVietnamLunarInfo().meritMultiplier || 1;
          const gain = 10 * mult;
          const nextSlot = currentRoom.wishingCards.length % 24;
          const card = {
            id: 'wish_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            playerId: player.id,
            nickname: player.nickname,
            category,
            wish: wishText,
            blessCount: 1,
            slotIdx: nextSlot,
            createdAt: Date.now()
          };
          currentRoom.wishingCards.push(card);
          if (currentRoom.wishingCards.length > 48) currentRoom.wishingCards.shift();
          currentRoom.totalMerits += gain;
          player.meritPoints += gain;
          scheduleSaveTempleState(currentRoom);

          currentRoom.broadcast({
            type: 'WISHING_CARD_HUNG',
            card,
            playerId: player.id,
            merits: player.meritPoints,
            roomTotalMerits: currentRoom.totalMerits
          });
          break;
        }

        case 'BLESS_WISHING_CARD': {
          if (!currentRoom || !player) return;
          if (!checkRateLimit(6)) return;
          const cardId = String(msg.cardId || '').substring(0, 80);
          if (!cardId) return;
          if (player.blessedWishingCards && player.blessedWishingCards.has(cardId)) {
            return ws.send(JSON.stringify({ type: 'WARN', message: 'Bạn đã tùy hỷ cầu phúc cho thẻ ước nguyện này rồi 🙏' }));
          }
          const targetCard = currentRoom.wishingCards.find(c => c.id === cardId);
          if (!targetCard) return;

          if (player.blessedWishingCards) {
            player.blessedWishingCards.add(cardId);
            if (player.blessedWishingCards.size > 120) {
              const firstKey = player.blessedWishingCards.values().next().value;
              player.blessedWishingCards.delete(firstKey);
            }
          }
          targetCard.blessCount = (Number(targetCard.blessCount) || 0) + 1;

          const mult = getVietnamLunarInfo().meritMultiplier || 1;
          const gain = 1 * mult;
          player.meritPoints += gain;
          currentRoom.totalMerits += gain;
          scheduleSaveTempleState(currentRoom);

          ws.send(JSON.stringify({
            type: 'MERIT_UPDATED',
            playerId: player.id,
            merits: player.meritPoints,
            delta: gain,
            reason: 'bless_wishing_card',
            cardId,
            roomTotalMerits: currentRoom.totalMerits
          }));

          currentRoom.broadcast({
            type: 'WISHING_CARD_BLESSED',
            cardId,
            blessCount: targetCard.blessCount,
            byNickname: player.nickname,
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
