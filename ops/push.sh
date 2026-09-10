#!/usr/bin/env bash
# Yeni sürümü depoya gönderir. Kullanım:
#   ops/push.sh                 → package.json'daki sürümü kullanır
#   ops/push.sh 1.9.0           → sürümü elle verir
#
# Bu betik parola veya token istemez; kimlik doğrulamayı git'in kendi
# kimlik yardımcısı yapar (aşağıdaki tek seferlik kuruluma bakın).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(node -p "require('./package.json').version" 2>/dev/null || true)}"
[ -n "$VERSION" ] || { echo "Sürüm belirlenemedi. Örnek: ops/push.sh 1.9.0"; exit 1; }

# --- Gönderim öncesi kontroller -------------------------------------------
command -v git >/dev/null || { echo "git kurulu değil."; exit 1; }
[ -d .git ] || { echo "Burada git deposu yok. GITHUB-PUSH.md bölüm 3'e bakın."; exit 1; }

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "DUR: .env dosyası depoya eklenmiş. Çıkarın: git rm --cached .env"; exit 1
fi
if [ -z "$(git remote 2>/dev/null)" ]; then
  echo "DUR: uzak depo tanımlı değil."
  echo "  git remote add origin https://github.com/<kullanici>/<depo>.git"; exit 1
fi

# --- Testler --------------------------------------------------------------
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "Testler çalışıyor..."
  npm test >/tmp/push-test.log 2>&1 || { echo "Testler geçmedi — /tmp/push-test.log"; exit 1; }
  tail -3 /tmp/push-test.log
  ops/security-scan.sh >/dev/null || { echo "Statik güvenlik denetimi bulgu verdi."; exit 1; }
  echo "Testler ve statik denetim temiz."
fi

# --- Commit, etiket, gönderim --------------------------------------------
git add -A
if git diff --cached --quiet; then
  echo "Değişiklik yok; yalnızca etiket gönderilecek."
else
  git commit -m "Sürüm $VERSION — ayrıntılar CHANGELOG.md"
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "v$VERSION etiketi zaten var, yeniden oluşturulmuyor."
else
  git tag -a "v$VERSION" -m "Sürüm $VERSION"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git push -u origin "$BRANCH"
git push origin "v$VERSION"
echo "Gönderildi: $BRANCH + v$VERSION"

# --- Tek seferlik kimlik kurulumu ----------------------------------------
# Token'ı bir kez git'in kendi deposuna yazın; bir daha sorulmaz:
#   git config --global credential.helper store     # Linux
#   git config --global credential.helper osxkeychain   # macOS
#   git config --global credential.helper manager-core  # Windows
# İlk push'ta kullanıcı adı ve parola sorulur; parola alanına token'ı yapıştırın.
# Token'ı bu betiğe, .env dosyasına veya herhangi bir yazışmaya YAZMAYIN.
