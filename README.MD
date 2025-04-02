1. Tải toàn bộ mã nguồn về để trong thư mục
2. Mở Terminal tại thư mục chứa (có Dockerfile) và chạy lệnh:
```CLI
docker build -t zalo-server .
```
3. Chạy
###Sau khi build xong, bạn có thể chạy container bằng lệnh:

docker run -p 3080:3080 zalo-server
