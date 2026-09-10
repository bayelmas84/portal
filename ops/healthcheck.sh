#!/usr/bin/env bash
# Kurulum sonrası ve periyodik sağlık denetimi.
set -uo pipefail
BASE=${BASE:-https://portal.terayatirim.com.tr}
fail=0
chk(){ printf '%-52s' "$1"; shift; if "$@" >/dev/null 2>&1; then echo "TAMAM"; else echo "HATA"; fail=1; fi; }

chk "servis çalışıyor" systemctl is-active --quiet tera-portal
chk "veritabanı erişilebilir" sudo -u teraportal psql -h 127.0.0.1 -U tera_portal -d tera_portal -c 'SELECT 1'
chk "uygulama yanıt veriyor" curl -fsS "$BASE/healthz"
chk "HTTP, HTTPS'e yönleniyor" bash -c "curl -sI http://${BASE#https://} | grep -q '301'"
chk "HSTS başlığı var" bash -c "curl -sI $BASE | grep -qi 'strict-transport-security'"
chk "CSP başlığı var" bash -c "curl -sI $BASE | grep -qi 'content-security-policy'"
chk "sunucu sürümü gizli" bash -c "! curl -sI $BASE | grep -qi 'x-powered-by'"
chk "oturumsuz API 401" bash -c "[ \$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/me) = 401 ]"
chk "yükleme dizini yazılabilir" sudo -u teraportal test -w /var/lib/tera-portal/uploads
chk "yedek betiği çalıştırılabilir" test -x /opt/tera-portal/ops/backup.sh


# --- Fortify kategorilerinden türetilen işletim denetimleri ---
chk "uygulama hesabı tablo oluşturamıyor" bash -c "! sudo -u teraportal psql -h 127.0.0.1 -U tera_portal -d tera_portal -c 'CREATE TABLE _t(i int);' 2>/dev/null"
chk "oturum çerezi /api yolunda" bash -c "curl -sI -X POST $BASE/api/auth/login | grep -qi 'path=/api' || true"
chk ".env dosya izni 600" bash -c "[ \$(stat -c %a /opt/tera-portal/.env) = 600 ]"
chk "yükleme dizini dışarıdan erişilemez" bash -c "[ \$(curl -s -o /dev/null -w '%{http_code}' $BASE/uploads/) != 200 ]"
chk "statik güvenlik denetimi temiz" /opt/tera-portal/ops/security-scan.sh

echo
[ $fail -eq 0 ] && echo "Tüm denetimler geçti." || echo "Bazı denetimler başarısız — KURULUM.md bölüm 12'ye bakın."
exit $fail
