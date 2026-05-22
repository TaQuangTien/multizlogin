# Zalo Tools v4

> **Phiên bản:** v4.20260522
> **Phát triển bởi:** Tiến Tạ — 2026
> **Dựa trên thư viện:** [zca-js](https://github.com/RFS-ADRENO/zca-js) (unofficial Zalo API)

---

## Miễn trừ trách nhiệm

```
Dự án sử dụng zca-js — thư viện cung cấp các API không chính thức (unofficial) cho Zalo.
Việc sử dụng công cụ này đồng nghĩa với việc bạn đang hoạt động ngoài phạm vi chính sách
của Zalo và có thể dẫn đến việc tài khoản bị vô hiệu hóa. Tác giả không chịu trách nhiệm
cho bất kỳ hậu quả nào phát sinh. Hãy cân nhắc kỹ trước khi sử dụng.
```

---

## Tổng quan

**Zalo Tools v4** là một REST API Server + Web UI được đóng gói bằng Docker, cho phép quản lý nhiều tài khoản Zalo cùng lúc. Hỗ trợ:

- Đăng nhập tài khoản Zalo qua QR Code (Selenium/Chrome tự động hóa)
- Quản lý proxy theo tài khoản
- Lắng nghe sự kiện tin nhắn, nhóm, reaction và đẩy về webhook ngoài (N8n, v.v.)
- REST API đầy đủ để gửi tin nhắn, ảnh, quản lý nhóm
- Export / Import cấu hình proxy và webhook

---

## A — CÀI ĐẶT & TRIỂN KHAI (Docker Compose)

### Tại sao dùng Docker?

Zalo Tools v4 được đóng gói trên nền **`selenium/standalone-chrome:latest`** — một image chứa sẵn **trình duyệt Chrome thật**, Xvfb (màn hình ảo), ChromeDriver và noVNC. Điều này đảm bảo:

- **Login QR Code thành công 100%** — Selenium điều khiển Chrome thật để mở trang Zalo Web, chụp mã QR và chuyển về giao diện quản lý. Không dùng headless giả lập, không bị Zalo chặn.
- **Giám sát trình duyệt qua noVNC** — truy cập `http://<server_ip>:7900` để xem trực tiếp Chrome đang làm gì bên trong container, hỗ trợ debug khi cần.
- **Một container = tất cả** — Node.js, Chrome, Selenium, Zalo Server chạy gọn trong một container duy nhất nhờ Supervisor quản lý process.

### Yêu cầu

- Docker & Docker Compose đã cài đặt
- Máy chủ có kết nối internet
- RAM tối thiểu **2GB** (Chrome thật cần bộ nhớ để render)

### Bước 1 — Tải mã nguồn và cấu hình

```bash
# Clone hoặc giải nén mã nguồn vào thư mục
cd zalo-tools-v4

# Sao chép file mẫu biến môi trường
cp .env.example .env
```

Mở file `.env` và chỉnh sửa:

| Biến               | Mô tả                                                                 | Ví dụ                |
|--------------------|-----------------------------------------------------------------------|----------------------|
| `ADMIN_USERNAME`   | Tên đăng nhập Web UI                                                  | `admin`              |
| `ADMIN_PASSWORD`   | Mật khẩu Web UI                                                       | `matkhau_manh_123`   |
| `X_API_KEY`        | Khóa xác thực cho REST API (header `x-api-key`)                      | `chuoi-bi-mat-api`   |
| `SESSION_SECRET`   | Chuỗi bí mật để mã hóa session Express                               | `session-secret-xyz` |
| `SELF_LISTEN`      | `true` / `false` — có nhận sự kiện từ tin nhắn của chính mình không  | `true`               |

### Bước 2 — Build và chạy

```bash
docker-compose up -d --build
```

Lần đầu tiên sẽ mất vài phút để build image (tải Chrome + Node.js). Các lần sau sẽ nhanh hơn nhờ Docker cache.

### Bước 3 — Kiểm tra trạng thái

```bash
# Xem container đang chạy
docker ps

# Xem log real-time
docker-compose logs -f

# Dừng server
docker-compose down
```

### Bước 4 — Truy cập

| Cổng   | Dịch vụ             | Địa chỉ                           |
|--------|---------------------|------------------------------------|
| `3000` | Web UI + REST API   | `http://<server_ip>:3000`          |
| `7900` | noVNC (xem Chrome)  | `http://<server_ip>:7900`          |

> Đăng nhập Web UI bằng `ADMIN_USERNAME` / `ADMIN_PASSWORD` đã cấu hình.
> noVNC không yêu cầu mật khẩu (đã cấu hình `VNC_NO_PASSWORD=1`).

### Cấu hình Docker Compose chi tiết

```yaml
services:
  zalo-bot-standalone:
    build: .                          # Build từ Dockerfile (selenium/standalone-chrome + Node.js)
    container_name: zalo-tools-v4
    ports:
      - "${APP_PORT:-3000}:3000"      # Web UI + API
      - "${VNC_PORT:-7900}:7900"      # noVNC — xem trình duyệt Chrome bên trong
    shm_size: 2gb                     # BẮT BUỘC — Chrome cần shared memory lớn để render
    restart: always                   # Tự khởi động lại khi crash hoặc reboot server
    environment:
      - START_XVFB=true              # Bật màn hình ảo cho Chrome
      - VNC_NO_PASSWORD=1            # noVNC không cần mật khẩu
      - SCREEN_WIDTH=1280            # Độ phân giải màn hình ảo
      - SCREEN_HEIGHT=800
      - SE_NODE_MAX_SESSIONS=1       # Chỉ 1 phiên Selenium cùng lúc
      - SE_NODE_SESSION_TIMEOUT=300  # Timeout 5 phút cho mỗi phiên login
      # --- Cấu hình ứng dụng ---
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=your_password
      - X_API_KEY=your-api-key
      - SESSION_SECRET=your-secret
      - SELF_LISTEN=true
    logging:
      driver: json-file
      options:
        max-size: "10m"              # Giới hạn log — tránh đầy ổ cứng
        max-file: "3"                # Xoay vòng tối đa 3 file (~30MB)
    volumes:
      - ./cookies:/app/cookies       # Lưu phiên đăng nhập Zalo (persist qua restart)
      - ./zalo_data:/app/zalo_data   # Lưu cấu hình proxy, webhook, users
```

**Lưu ý quan trọng:**
- `shm_size: 2gb` là **bắt buộc**. Chrome thật sử dụng shared memory để render trang web. Nếu thiếu, Chrome sẽ crash khi mở Zalo Web và login sẽ thất bại.
- Thư mục `cookies/` và `zalo_data/` được mount ra ngoài container. Khi `docker-compose down` rồi `up` lại, toàn bộ phiên đăng nhập và cấu hình vẫn được giữ nguyên.
- Container sử dụng **Supervisor** để chạy đồng thời: Chrome + Xvfb + noVNC + Node.js server.

---

## B — SỬ DỤNG

### 1. Cấu hình Webhook

Vào tab **Webhook** trên giao diện, dán URL webhook (N8n hoặc bất kỳ endpoint nào) vào các ô tương ứng:

- **Message Webhook** — nhận sự kiện tin nhắn mới
- **Group Event Webhook** — nhận sự kiện nhóm (thêm/xóa thành viên, v.v.)
- **Reaction Webhook** — nhận sự kiện reaction
- **Connection Webhook** — nhận sự kiện kết nối/ngắt kết nối tài khoản

### 2. Đăng nhập tài khoản Zalo

1. Vào tab **Tài khoản** → nhấn **Đăng nhập qua QR Code**
2. Chọn proxy nếu cần (tùy chọn)
3. Mã QR sẽ hiện ra — mở Zalo trên điện thoại và quét
4. Sau khi quét thành công, tài khoản sẽ xuất hiện trong danh sách

### 3. Quản lý Proxy

Vào tab **Proxy** để thêm/xóa proxy. Mỗi proxy hỗ trợ tối đa 3 tài khoản đồng thời.

Format proxy hỗ trợ:
```
http://user:pass@host:port
socks5://user:pass@host:port
```

### 4. Export / Import dữ liệu

Vào tab **Export/Import** để:
- Tải xuống file cấu hình `proxies.json`, `webhook-config.json`
- Tải xuống session tài khoản `cred_<ownId>.json` để backup
- Import lại cấu hình hoặc session từ file JSON

---

## C — API REFERENCE

Tất cả các endpoint API yêu cầu header:

```
x-api-key: <X_API_KEY>
```

Xem tài liệu đầy đủ tại: `http://<server_ip>:3000/api-doc`

### Danh sách endpoint

| Method | Endpoint                  | Mô tả                         |
|--------|---------------------------|-------------------------------|
| GET    | `/accounts`               | Danh sách tài khoản đăng nhập |
| POST   | `/sendmessage`            | Gửi tin nhắn văn bản          |
| POST   | `/sendImageToUser`        | Gửi ảnh đến người dùng        |
| POST   | `/sendImagesToUser`       | Gửi nhiều ảnh đến người dùng  |
| POST   | `/sendImageToGroup`       | Gửi ảnh đến nhóm              |
| POST   | `/sendImagesToGroup`      | Gửi nhiều ảnh đến nhóm        |
| POST   | `/findUser`               | Tìm kiếm người dùng           |
| POST   | `/getUserInfo`            | Lấy thông tin người dùng      |
| POST   | `/getGroupInfo`           | Lấy thông tin nhóm            |
| POST   | `/createGroup`            | Tạo nhóm mới                  |
| POST   | `/addUserToGroup`         | Thêm thành viên vào nhóm      |
| POST   | `/removeUserFromGroup`    | Xóa thành viên khỏi nhóm      |
| POST   | `/sendFriendRequest`      | Gửi lời mời kết bạn           |

---

## D — CẤU TRÚC DỰ ÁN

```
zalo-tools-v4/
├── server.js              # Entry point — Express, WebSocket, session, load cookies
├── routes.js              # Kết hợp UI router và API router
├── routes-ui.js           # Giao diện Web — dashboard, proxy, QR login, export/import
├── routes-api.js          # REST API endpoints
├── api/zalo/zalo.js       # Zalo client (zca-js wrapper) — login, messaging, group
├── eventListeners.js      # Lắng nghe sự kiện Zalo và đẩy webhook
├── helpers.js             # Gửi webhook HTTP, xử lý ảnh
├── middleware.js          # Xác thực Basic Auth (UI) và X-API-Key (API)
├── proxyService.js        # Quản lý danh sách proxy
├── seleniumService.js     # Tự động hóa Chrome để lấy QR Code
├── zaloService.js         # Re-export Zalo service
├── Dockerfile             # Docker image (dựa trên selenium/standalone-chrome)
├── docker-compose.yaml    # Cấu hình Docker Compose
└── zalo_data/             # Dữ liệu runtime (volume Docker)
    ├── proxies.json       # Danh sách proxy
    ├── webhook-config.json# Cấu hình URL webhook
    └── webhooks.json      # Webhook per-account
```

---

## E — GAS TEMPLATE: MARKETING TỰ ĐỘNG QUA GOOGLE SHEETS

Docker Server này là **mã nguồn mở** — bạn tự do sử dụng, triển khai và tích hợp vào bất kỳ hệ thống nào (N8n, Make, custom webhook, v.v.). Nếu bạn cần một **giải pháp marketing Zalo dùng ngay, không cần code**, **GAS Template** là lựa chọn hoàn hảo — bộ Google Apps Script biến Google Sheets thành trung tâm điều khiển tự động.

![GAS TEMPLATE](GAS_Demo.png)

### Cách hoạt động

Bạn nhập **số điện thoại + nội dung tin nhắn** vào Google Sheets. Hệ thống tự xử lý phần còn lại:

```
Bạn nhập SĐT + tin nhắn vào Sheets
        │
        ▼
  Docker kéo tác vụ (mỗi 30s)
        │
        ▼
  Tự tìm UID → Chưa bạn bè? → Tự gửi kết bạn → Chờ đồng ý → Tự gửi tin nhắn
        │                                                            │
        ▼                                                            ▼
  Kết quả trả về Sheets                                           DONE ✓
```

Không cần IP tĩnh, không cần domain — Docker chủ động kéo việc từ Google Sheets.

### Tính năng chính

**CRM trên Google Sheets**
- Tự động lưu danh bạ khách hàng (tên, SĐT, UID, avatar)
- Phân loại tự động: `HOT` / `WARM` / `COLD` theo tương tác gần nhất
- Gắn Tags phân nhóm khách hàng

**Gửi tin nhắn hàng loạt**
- Gửi cá nhân (text + ảnh), gửi nhóm
- Tự kết bạn trước khi gửi nếu chưa là bạn bè
- Thu hồi lời kết bạn sau 24h nếu không được chấp nhận

**Trả lời tự động (Auto Reply)**
- Kịch bản theo từ khóa, hẹn giờ, chọn ngày trong tuần
- Chống spam: giãn cách 5 phút cùng một người

**Bảo vệ tài khoản**
- Giới hạn tự động: 200 tin nhắn/ngày, 30 kết bạn/ngày, 15 tìm UID/giờ
- Tùy chỉnh được trực tiếp trên Sheets

**Dashboard giám sát**
- Giao diện web dark mode, bảo vệ bằng PIN
- Thống kê real-time, nhật ký hệ thống, biểu đồ quota
- Tạm dừng / tiếp tục chiến dịch bằng 1 click

---

## F — ĐẶT MUA GAS TEMPLATE

### Bao gồm:
- Google Sheets template cấu hình sẵn (10+ sheet)
- Google Apps Script hoàn chỉnh (Dashboard, FlowChart, CRM, Auto Reply)
- Hướng dẫn triển khai chi tiết
- Hỗ trợ kỹ thuật ban đầu

### Giá: **500.000 VND** — mua một lần, bảo hành 1 năm, nhận các bản cập nhật thường xuyên sau đó.

### Liên hệ:

```
  Tiến Tạ
  Zalo / Điện thoại: 0387 553 113
```

---

## G — GHI CHÚ KỸ THUẬT

- **Xác thực Web UI**: HTTP Basic Auth + Session cookie
- **Xác thực API**: Header `x-api-key`
- **Session**: Mã hóa bằng `SESSION_SECRET`, cookie `secure` khi `NODE_ENV=production`
- **Docker base image**: `selenium/standalone-chrome:latest` (tích hợp sẵn Xvfb, ChromeDriver)
- **Node.js**: v18+
- **Port mặc định**: 3000

---

## Thông tin

**Phiên bản:** v4.20260522
**Tác giả:** Tiến Tạ
**Năm:** 2026
**Docker Server:** Mã nguồn mở
**GAS Template:** Bản quyền — liên hệ 0387 553 113 để đặt mua
