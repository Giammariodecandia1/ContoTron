@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "LOCAL_URL=http://localhost:5173/"
set "LAN_IP="

for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /R /C:"IPv4"') do (
  if not defined LAN_IP set "LAN_IP=%%A"
)
set "LAN_IP=%LAN_IP: =%"

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
if defined LAN_IP (
  echo Da smartphone sulla stessa Wi-Fi prova: http://%LAN_IP%:5173/
)
echo.
echo Lascia aperta questa finestra mentre testi il tool.
echo Per fermare il server premi CTRL+C.
echo.

start "" "%LOCAL_URL%"
call npm run dev -- --host 0.0.0.0 --port 5173

echo.
echo Server locale fermato.
pause
