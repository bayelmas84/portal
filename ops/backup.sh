#!/usr/bin/env bash
# Günlük yedek: veritabanı + yüklenen dosyalar + denetim kaydı dışa aktarımı.
# Cron: 0 2 * * * /opt/tera-portal/ops/backup.sh >> /var/log/tera-portal/backup.log 2>&1
set -Eeuo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/tera-portal}
KEEP_DAYS=${KEEP_DAYS:-30}
STAMP=$(date +%Y%m%d-%H%M)
source /opt/tera-portal/.env

mkdir -p "$BACKUP_DIR"
umask 0077

echo "[$(date -Is)] veritabanı yedeği alınıyor"
PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Fc \
  -f "$BACKUP_DIR/db-$STAMP.dump"

echo "[$(date -Is)] yüklenen dosyalar arşivleniyor"
tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"

# Denetim kaydı ayrıca düz metin olarak dışa aktarılır; WORM/salt-okunur alana kopyalanmalıdır.
echo "[$(date -Is)] denetim kaydı dışa aktarılıyor"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -At \
  -c "COPY (SELECT id, at, actor, event, ok, hash FROM audit_log ORDER BY id) TO STDOUT WITH CSV HEADER" \
  | gzip > "$BACKUP_DIR/audit-$STAMP.csv.gz"

sha256sum "$BACKUP_DIR"/*-"$STAMP".* > "$BACKUP_DIR/SHA256-$STAMP.txt"
find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "[$(date -Is)] yedek tamamlandı: $STAMP"
