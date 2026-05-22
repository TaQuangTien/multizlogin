FROM selenium/standalone-chrome:4.27.0-20250101

USER root

RUN /home/seluser/venv/bin/pip uninstall -y numpy || true

RUN apt-get update && \
    apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs libvips-dev tzdata && \
    ln -fs /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime && \
    dpkg-reconfigure -f noninteractive tzdata

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

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

EXPOSE 3000 7900 4444

ENTRYPOINT ["/opt/bin/entry_point.sh"]
