Miễn trừ trách nhiệm:
```text
Dự án có sử dụng - ZCA-JS
Là một thư viện cung cấp các API (unofficial) hỗ trợ bạn xây dựng 1 bot chat Zalo bằng chính tài khoản cá nhân của bạn.

Lưu ý: việc sử dụng thư viện này đồng nghĩa với việc bạn đang làm trái với chính sách của Zalo và nó có thể khiến cho tài khoản của bạn bị vô hiệu hóa. Chúng tôi sẽ không chịu trách nhiệm nếu điều đó xảy ra, vậy nên hãy cân nhắc trước khi sử dụng.
```

A- CÀI ĐẶT

1. Tải toàn bộ mã nguồn về để trong thư mục (multizlogin)

2. Mở Terminal tại thư mục (multizlogin) và chạy lệnh:
```CLI
docker build -t zalo-server .
```

3. Sau khi build xong, bạn có thể tạo container bằng lệnh:
```CLI
docker run --restart=on-failure -d --name zalo-server-new   -p 3000:3000   -e ADMIN_USERNAME=admin   -e ADMIN_PASSWORD=admin   -e X_API_KEY=your-secret-api-key   -e SESSION_SECRET=your-secret zalo-server:latest
```

4. Truy cập container_ip:3000 để sử dụng

5. Các biến môi trường cần lưu ý:
  - ADMIN_USERNAME=admin // Tên đăng nhập trang chủ + Basic Authentication cho các POST request tới API
  - ADMIN_PASSWORD=admin // Mật khẩu đăng nhập trang chủ + Basic Authentication cho các POST request tới API
  - X_API_KEY=your-secret-api-key // Header x-api-key để xác thực các POST request tới API

B- SỬ DỤNG

1. Cập nhật Webhook (POST) - copy từ n8n
2. Bấm Đăng nhập qua QR Code
3. Thêm Proxy nếu cần và Bấm đăng nhập
4. Dùng Zalo quét mã QR hiện ra để đăng nhập
5. Sau khi đăng nhập thành công, mọi sự kiện sẽ được đẩy về Webhook
6. Đọc tài liệu API để biết cách gửi Message, Photo, Sticker,...

Credit: Cang Pham | https://www.facebook.com/share/p/1ADmjWHWE7/
Modified: TienTa
