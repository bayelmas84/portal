#!/usr/bin/env bash
# Statik güvenlik denetimi.
# Kontroller, PRISMA projesinin Fortify SCA raporunda çıkan kategorilerden türetilmiştir;
# aynı kalıpların bu kod tabanında oluşmadığı her sürümde doğrulanır.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
say(){ printf '%-58s %s\n' "$1" "$2"; }

# grep tabanlı kalıp denetimi: bulgu varsa listeler
check(){ local hits
  hits=$(grep -rnE "$2" server/src client ops --include='*.js' 2>/dev/null | grep -v node_modules || true)
  if [ -n "$hits" ]; then say "$1" "BULGU"; echo "$hits" | head -5 | sed 's/^/    /'; fail=1
  else say "$1" "temiz"; fi }

# olması gereken kalıp yoksa bulgu
require(){ if grep -rqE "$2" $3 2>/dev/null; then say "$1" "temiz"; else say "$1" "BULGU"; fail=1; fi }

echo "== Tera Portal statik güvenlik denetimi (Fortify kategorileri) =="
check "Password Management: sabit kimlik bilgisi"     '(password|parola|secret|api[_-]?key|passwd)\s*[:=]\s*["'\''][^"'\'']{8,}'
check "Password Management: parola günlüğe yazımı"     'console\.(log|error|warn)\([^)]*(password|parola)'
check "Insecure Randomness"                            '\bMath\.random\('
check "Header Manipulation: istek verisi başlığa"      'setHeader\([^,]+,\s*[^)]*req\.(query|params|body|headers)'
check "Path Manipulation: istek verisi dosya yoluna"   '(readFile|writeFile|sendFile|createReadStream)\([^)]*req\.(query|params|body)'
check "Command Injection: kabuk çağrısı"               "require\(['\"]child_process|exec\(|execSync\("
check "Code Injection: eval / new Function"            '\beval\(|new Function\('
check "XSS: kaçırılmamış girdi innerHTML'e"            'innerHTML\s*=\s*[^"'\''`]*\+\s*[a-z]'
check "XSS: document.write"                            'document\.write\('
check "Insecure Transport: kaynakta http:// dış adres" 'https?://(?!127\.0\.0\.1|localhost)[a-z0-9.-]+"\s*\)\s*;?\s*//\s*prod'
check "Insecure Transport: TLS doğrulaması kapatma"    'rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED'
check "Privacy Violation: tarayıcı deposunda oturum"   'localStorage|sessionStorage'
check "SQL: sorgu metninde şablon değişkeni"           '(query|one|many)\(\s*`[^`]*\$\{'
check "Setting Manipulation: process.env yazımı"       'process\.env\[[^]]*\]\s*='

require "Cookie Security: çerez yolu /api ile sınırlı"  'path: "/api"'      "server/src/middleware/auth.js server/src/middleware/security.js"
require "CSRF: çift gönderim doğrulaması var"           'x-csrf-token'      "server/src/middleware/security.js"
require "Bilgi sızıntısı: 5xx genel mesaj döner"        'Beklenmeyen hata'  "server/src/middleware/errors.js"
require "Privacy: günlükte maskeleme var"               'function mask'     "server/src/middleware/errors.js"
require "Konteyner: root olmayan kullanıcı"             '^USER node'        "ops/Dockerfile"
require "Konteyner: yetenekler düşürülmüş"              'cap_drop'          "ops/docker-compose.yml"
require "Veritabanı: en az yetki betiği var"            'REVOKE CREATE ON SCHEMA' "ops/least-privilege.sql"

printf '%-58s ' ".env sürüm kontrolünde değil"
if grep -q '^\.env$' .gitignore 2>/dev/null; then echo "temiz"; else echo "BULGU"; fail=1; fi

printf '%-58s ' "bağımlılık zafiyeti"
if npm audit --omit=dev >/dev/null 2>&1; then echo "temiz"; else echo "BULGU"; fail=1; fi

echo
[ $fail -eq 0 ] && echo "Statik denetim temiz." || echo "Bulgular giderilmeden sürüm alınmamalıdır."
exit $fail
