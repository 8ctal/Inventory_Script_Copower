@echo off
:: Este script lanza el PowerShell con permisos de Bypass para que se ejecute sin preguntar
echo Sincronizando informacion del equipo con la base de datos central...
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Inventario.ps1"
echo Sincronizando informacion del monitor con la base de datos central...
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Inventario_Monitor.ps1"
echo Sincronizando informacion del celular con la base de datos central...
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Inventario_Celular.ps1"
:: Si quieres que la ventana se cierre sola tras terminar, comenta la linea de abajo
pause