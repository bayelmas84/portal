# Tera Portal — üretim imajı
# Konteyner root olmayan kullanıcıyla çalışır; dosya sistemi salt okunurdur.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    UPLOAD_DIR=/var/lib/tera-portal/uploads
WORKDIR /app

# Güvenlik yamalarını al, gereksiz paketleri bırakma
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
COPY client ./client
COPY package.json ./

# Yükleme ve günlük dizinleri konteyner dışından bağlanır (salt okunur kök için gerekli)
RUN mkdir -p /var/lib/tera-portal/uploads && chown -R node:node /var/lib/tera-portal

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
