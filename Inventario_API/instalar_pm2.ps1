# Script para instalar y configurar PM2 para el servicio de inventario

Write-Host "=== Instalacion de PM2 para Inventario API ===" -ForegroundColor Cyan
Write-Host ""

# Verificar si Node.js está instalado
try {
    $nodeVersion = node --version
    Write-Host "Node.js encontrado: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js no está instalado o no está en el PATH" -ForegroundColor Red
    Write-Host "Por favor instala Node.js desde https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Verificar si npm está instalado
try {
    $npmVersion = npm --version
    Write-Host "npm encontrado: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: npm no está instalado" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Instalando PM2 globalmente..." -ForegroundColor Yellow
npm install -g pm2

if ($LASTEXITCODE -eq 0) {
    Write-Host "PM2 instalado correctamente" -ForegroundColor Green
} else {
    Write-Host "ERROR: No se pudo instalar PM2" -ForegroundColor Red
    Write-Host "Intenta ejecutar PowerShell como Administrador" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Configurando el servicio..." -ForegroundColor Yellow

# Obtener la ruta actual del script
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiPath = $scriptPath

# Cambiar al directorio API
Set-Location $apiPath

# Verificar que server.js existe
if (-not (Test-Path "server.js")) {
    Write-Host "ERROR: No se encontró server.js en $apiPath" -ForegroundColor Red
    exit 1
}

# Verificar que .env existe
if (-not (Test-Path ".env")) {
    Write-Host "ADVERTENCIA: No se encontró archivo .env" -ForegroundColor Yellow
    Write-Host "Asegúrate de crear el archivo .env con DATABASE_URL" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Iniciando el servidor con PM2..." -ForegroundColor Yellow
pm2 start server.js --name inventario-api

if ($LASTEXITCODE -eq 0) {
    Write-Host "Servidor iniciado correctamente" -ForegroundColor Green
} else {
    Write-Host "ERROR: No se pudo iniciar el servidor" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Configurando inicio automático..." -ForegroundColor Yellow
Write-Host "NOTA: Esto requiere ejecutar comandos adicionales. Sigue las instrucciones que aparezcan." -ForegroundColor Cyan
pm2 startup

Write-Host ""
Write-Host "Guardando configuración..." -ForegroundColor Yellow
pm2 save

Write-Host ""
Write-Host "=== Instalacion completada ===" -ForegroundColor Green
Write-Host ""
Write-Host "Comandos utiles:" -ForegroundColor Cyan
Write-Host "  Ver estado: pm2 status" -ForegroundColor White
Write-Host "  Ver logs: pm2 logs inventario-api" -ForegroundColor White
Write-Host "  Reiniciar: pm2 restart inventario-api" -ForegroundColor White
Write-Host "  Detener: pm2 stop inventario-api" -ForegroundColor White
Write-Host "  Monitoreo: pm2 monit" -ForegroundColor White
Write-Host ""

