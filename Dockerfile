# Sử dụng Image Selenium Standalone Chrome làm nền tảng (đã có sẵn Xvfb, noVNC, Chrome)
FROM selenium/standalone-chrome:latest

USER root

# Cài đặt Node.js 18.x
RUN apt-get update && \
    apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs libvips-dev

# Đặt thư mục làm việc cho ứng dụng Node.js
WORKDIR /app

# Copy các tệp cấu hình package trước để cài đặt dependency
COPY package*.json ./

# Cài đặt dependency
RUN npm install

# Copy toàn bộ mã nguồn vào container
COPY . .

# Đảm bảo quyền sở hữu của người dùng seluser (người dùng mặc định của selenium image)
# và phân phối file cấu hình cho supervisor của Selenium
RUN chown -R seluser:seluser /app && \
    chmod -R 777 /app && \
    echo "[program:zalo-bot]\n\
command=npm start\n\
directory=/app\n\
user=seluser\n\
autostart=true\n\
autorestart=true\n\
stdout_logfile=/var/log/zalo-bot.log\n\
stderr_logfile=/var/log/zalo-bot.err.log" > /etc/supervisor/conf.d/zalo-bot.conf

# Expose các cổng quan trọng
# 3000: Zalo Bot Management UI
# 7900: noVNC GUI
# 4444: Selenium Grid
EXPOSE 3000 7900 4444

# Sử dụng entrypoint mặc định của Selenium (sẽ tự động chạy supervisord)
ENTRYPOINT ["/opt/bin/entry_point.sh"]
