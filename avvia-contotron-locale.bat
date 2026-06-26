@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "LOCAL_URL=http://localhost:5173/"

title Contotron - Avvio locale

echo.
echo ==========================================
echo   Contotron - ambiente locale di test
echo ==========================================
echo.

cd /d "%PROJECT_DIR%"

where node >nul 2>nul
if errorlevel 1 (
  echo ERRORE: Node.js non e' installato o non e' nel PATH.
  echo Installa Node.js, poi riapri questo file.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Dipendenze non trovate. Avvio npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERRORE: installazione dipendenze non riuscita.
    pause
    exit /b 1
  )
)

echo Avvio Contotron su %LOCAL_URL%
echo.
echo Lascia aperta questa finestra mentre testi il tool.
echo Per fermare il server premi CTRL+C.
echo.

start "" "%LOCAL_URL%"
call npm run dev -- --host 127.0.0.1 --port 5173

echo.
echo Server locale fermato.
pause
