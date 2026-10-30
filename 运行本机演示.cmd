@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "APP_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%APP_NODE%" set "APP_NODE=node"
"%APP_NODE%" -e "require('node:sqlite')" >nul 2>&1
if errorlevel 1 (
  echo 需要支持 node:sqlite 的 Node.js 22 或更高版本。
  pause
  exit /b 1
)
set "PAYMATE_ENABLE_PAYPAL=false"
set "PAYMATE_ENABLE_AI=false"
set "PAYMATE_PORT=8787"
set "PAYMATE_PUBLIC_BASE_URL=http://127.0.0.1:8787"
set "PAYMATE_DB=%~dp0data\local-demo.db"
echo 这是本机离线演示，不连接 PayPal 或外部模型接口。
echo 启动后用浏览器打开：http://127.0.0.1:8787
echo 关闭这个窗口或按 Ctrl+C 即可停止。
echo 如果提示端口已占用，直接打开上面的地址，不要重复启动。
"%APP_NODE%" --max-old-space-size=128 server.js
pause
