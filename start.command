#!/bin/zsh
# Запуск «Голосовой бриф вакансии» на macOS: двойной щелчок в Finder.
# Проверяет Node.js, создаёт .env из .env.example, ставит зависимости и запускает dev-сервер.
cd "${0:A:h}" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1
fi

pause() { read "?Нажмите Enter, чтобы закрыть окно..."; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Установите Node.js 22 LTS: https://nodejs.org/ (или: brew install node@22)"
  pause; exit 1
fi

ver=$(node -p 'process.versions.node')
if ! node -e 'const [a,b,c]=process.versions.node.split(".").map(Number);process.exit((a===22&&(b>22||(b===22&&c>=2)))||(a===24&&b>=15)||a>=26?0:1)'; then
  echo "Нужен Node 22.22.2+ (ветка 22), 24.15+ (ветка 24) или 26+. Сейчас: $ver"
  pause; exit 1
fi
echo "Node $ver, npm $(npm -v)"

[ -f .env ] || cp .env.example .env

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Устанавливаю зависимости (npm ci)..."
  npm ci --no-audit --no-fund || { echo "npm ci завершился с ошибкой"; pause; exit 1; }
fi

echo "Запускаю приложение: http://127.0.0.1:5173 (остановить — Ctrl+C)"
( sleep 8; open "http://127.0.0.1:5173" ) &
npm run dev
pause
