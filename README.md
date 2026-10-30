# 🪷 Thiền Viện Đại Bi 3D - Không Gian Tu Tập & Trực Tuyến Đa Người Chơi

Không gian chùa Việt 3D trực tuyến kết nối tâm linh, tọa thiền kiết già, tụng đọc 11 bộ Đại Kinh Phật giáo, thả hoa đăng cầu an và lắng nghe chuông mõ thanh tịnh trong thời gian thực.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/phongeditor99-oss/thien-vien-dai-bi-3d)

---

## 🌟 Tính Năng Nổi Bật

1. **Không Gian Tâm Linh 3D Thanh Tịnh:**
   - Chánh Điện tôn nghiêm với tượng Phật Thích Ca Mâu Ni, tượng Bồ Tát Quán Thế Âm, tượng Phật A Di Đà, và Phật Nhập Niết Bàn.
   - 108 bồ đoàn đệm ngồi tọa thiền quanh Chánh Điện có đánh số vị trí.
   - Khuôn viên hoa anh đào, hồ sen cá Koi bơi lội, tiểu cảnh non bộ thạch lâm và cầu kiều.
   - Khung cảnh Ngày / Hoàng Hôn / Đêm Trăng theo thời gian thực hoặc tùy chỉnh.

2. **Đồng Bộ Đa Người Chơi (Multiplayer Real-time):**
   - Kết nối hàng trăm đồng tu cùng lúc qua WebSocket.
   - Nhìn thấy các chú tiểu đồng tu di chuyển, tọa thiền, đổi màu áo cà sa (Hoàng Y, Nâu Sồng, Lam Y, Bạch Y).
   - Hệ thống đảnh lễ bái Phật, gõ mõ, thỉnh đại hồng chung đồng bộ tức thì.
   - Kênh chat cộng đồng tu tập thanh tịnh.

3. **Kho Tàng Kinh Điển Trọn Bộ (11 Bộ Đại Kinh):**
   - **Kinh Địa Tạng Bồ Tát Bổn Nguyện** (Trọn bộ toàn văn các phẩm khai kinh và hồi hướng).
   - **Kinh Dược Sư Lưu Ly Quang Như Lai Bổn Nguyện Công Đức** (12 Đại Nguyện & Chân Ngôn).
   - **Kinh Phật Thuyết A Di Đà** (Cảnh giới Tây Phương Cực Lạc).
   - **Kinh Kim Cang Bát Nhã Ba La Mật** (Phá Tứ Tướng, Tứ Cú Kệ).
   - **Kinh Phổ Môn Bồ Tát Quán Thế Âm** (33 Ứng Thân cứu khổ).
   - **Kinh Phật Thuyết Vu Lan Bồn** (Báo hiếu cha mẹ).
   - **Kinh Bát Đại Nhân Giác** (Tám điều giác ngộ).
   - **Kinh Phước Đức** (Mangala Sutta - 38 điềm lành).
   - **Kinh Thập Thiện Nghiệp Đạo** (10 nghiệp lành).
   - **Kinh Từ Bi** (Metta Sutta - Rải tâm từ vô lượng).
   - **Bát Nhã Ba La Mật Đa Tâm Kinh & Thập Chú Mật Tông**.

4. **Thả Đèn Hoa Đăng Cầu Nguyện:**
   - Đèn hoa đăng 3D dập dềnh bập bềnh theo sóng nước hồ sen.
   - Tùy chọn sắc hoa đăng (Sen Hồng Từ Bi, Sen Vàng Trí Tuệ, Sen Trắng Thanh Tịnh).
   - Nhập lời chúc/cầu an hoặc chọn mẫu nguyện ước hiếu nghĩa, gia đạo, vạn sự cát tường.
   - Đồng bộ hoa đăng với tất cả người chơi trong phòng.

5. **Tối Ưu 100% Cho Thiết Bị Di Động (Mobile Friendly):**
   - Cần gạt ảo (Virtual Joystick) di chuyển mượt mà.
   - Vuốt ngón tay xoay góc nhìn 360 độ tự do.
   - Thu phóng 2 ngón tay (Pinch to zoom) linh hoạt.
   - Thanh công cụ HUD tiện lợi (Gõ mõ, chuông bát, đại chung, tọa thiền, tụng kinh, đăng hương, hoa đăng, niệm phật, xin xăm).

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Cục Bộ (Local)

```bash
# Clone dự án
git clone https://github.com/phongeditor99-oss/thien-vien-dai-bi-3d.git
cd thien-vien-dai-bi-3d

# Cài đặt thư viện
npm install

# Khởi động máy chủ
npm start
```

Mở trình duyệt truy cập: `http://localhost:3000`

---

## 🌐 Triển Khai Lên Render.com (Miễn Phí)

1. Đăng nhập vào [dashboard.render.com](https://dashboard.render.com/) bằng tài khoản GitHub.
2. Bấm **New +** ➔ Chọn **Web Service**.
3. Chọn kho mã nguồn `phongeditor99-oss/thien-vien-dai-bi-3d`.
4. Render sẽ tự động nhận diện cấu hình từ `render.yaml`:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node src/server.js`
5. Bấm **Create Web Service**. Sau 1 - 2 phút, Render sẽ cấp đường dẫn trực tuyến vĩnh viễn (ví dụ: `https://thien-vien-dai-bi-3d.onrender.com`).
