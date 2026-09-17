# BY Portal — üretim imajı
# Node 20 LTS, Alpine tabanlı (küçük imaj boyutu, güvenlik yaması alan bir dağıtım).
FROM node:20-alpine

# argon2 (şifre hashleme) ve bazı npm paketleri derleme aracı gerektirir.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Bağımlılıkları önce kopyalayıp kurmak, kaynak kod değiştiğinde
# Docker'ın npm install katmanını yeniden kullanmasını (cache) sağlar.
COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server

# Yüklenen dosyalar (eğitim dokümanları vb.) konteyner dışında bir
# volume'da tutulmalı — bkz. docker-compose.yml.
RUN mkdir -p /var/lib/byelmas-portal/uploads

# Uygulama kök yetkisiyle çalışmamalı.
RUN addgroup -S byelmasportal && adduser -S byelmasportal -G byelmasportal \
    && chown -R byelmasportal:byelmasportal /app /var/lib/byelmas-portal
USER byelmasportal

EXPOSE 8080

# Basit sağlık kontrolü: /api/healthz zaten ağ kısıtlamasından muaf ve
# kimlik doğrulama gerektirmiyor.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/api/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
