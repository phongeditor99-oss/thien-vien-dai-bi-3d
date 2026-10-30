# Hệ Thống Game Tu Tập Đa Nền Tảng (Zen Retreat MMO)

## 1. Giới thiệu dự án
Hệ thống Server thời gian thực hỗ trợ **100 người đồng quy trong 1 phòng thiền đường (Virtual Buddhist Temple)**.
Hỗ trợ đa nền tảng: **iOS, Android (thông qua Unity/Flutter)** và Web Client.

## 2. Tính năng chính (Core Features)
- **Thiền đường 100 bồ đoàn**: Người chơi có thể tự do chọn chỗ ngồi, toạ thiền.
- **Pháp khí tương tác**:
  - **Gõ mõ (Wooden Fish)**: Âm thanh mõ gỗ, tích luỹ công đức, hiển thị số lần gõ thời gian thực.
  - **Đại Hồng Chung (Temple Bell)**: Âm thanh chuông chùa ngân vang đa tần số, cooldown chống spam.
  - **Lần tràng hạt (Mala Beads)**: Vòng chuỗi 108 hạt niệm Phật.
  - **Tọa thiền (Meditation)**: Chế độ tịnh tâm, đồng bộ trạng thái thiền với mọi người trong phòng.
  - **Thắp hương (Incense)**: Tuần hương cúng dường Tam Bảo.
- **Đồng bộ thời gian thực**: WebSocket Authoritative Server chống gian lận, chống tranh chấp ghế (Atomic seat reservation), rate limiter chống spam.

## 3. Cách chạy thử nghiệm nhanh (Web Simulation)
1. Cài đặt phụ thuộc:
   ```bash
   npm install
   ```
2. Khởi động server:
   ```bash
   node src/server.js
   ```
3. Mở trình duyệt truy cập: `http://localhost:3000` (có thể mở nhiều tab hoặc nhiều trình duyệt khác nhau để kiểm tra tính năng đồng bộ 100 người).
4. Chạy kịch bản kiểm thử tải tự động 100 người:
   ```bash
   node scripts/stress-test.js
   ```
