<#
.SYNOPSIS
    Script para registrar celulares/dispositivos móviles en el sistema de inventario.
.DESCRIPTION
    Formulario interactivo para ingresar los datos del celular manualmente
    (marca, modelo, serial, IMEI, número de línea, empleado asignado)
    y enviarlos al servidor de inventario.
#>

$UrlEndpoint = "http://192.168.20.5:3000/api/celular"

try {
    Clear-Host
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "   INVENTARIO DE CELULARES" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Ingrese los datos del dispositivo movil:" -ForegroundColor Yellow
    Write-Host ""

    # ---- Datos del dispositivo ----
    Write-Host "Marca [Ej: Samsung, Apple, Motorola]" -ForegroundColor White
    $marca = Read-Host "Marca"
    $marca = $marca.Trim()

    Write-Host "Modelo [Ej: Galaxy S23, iPhone 14, Moto G84]" -ForegroundColor White
    $modelo = Read-Host "Modelo"
    $modelo = $modelo.Trim()

    Write-Host "Serial del dispositivo (requerido)" -ForegroundColor White
    $serial = Read-Host "Serial"
    $serial = $serial.Trim()

    if (-not $serial -or $serial -eq "") {
        Write-Host "ERROR: El serial es obligatorio." -ForegroundColor Red
        exit 1
    }

    Write-Host "IMEI [15 digitos, se encuentra en Ajustes > Acerca del telefono]" -ForegroundColor White
    Write-Host "Presione Enter para omitir" -NoNewline -ForegroundColor Gray
    Write-Host ""
    $imei = Read-Host "IMEI"
    $imei = if ($imei.Trim() -ne "") { $imei.Trim() } else { $null }

    Write-Host "Numero de linea telefonica [Ej: 3001234567]" -ForegroundColor White
    Write-Host "Presione Enter para omitir" -NoNewline -ForegroundColor Gray
    Write-Host ""
    $numeroLinea = Read-Host "Numero de linea"
    $numeroLinea = if ($numeroLinea.Trim() -ne "") { $numeroLinea.Trim() } else { $null }

    # ---- Empleado ----
    Write-Host ""
    Write-Host "--- ASIGNACION DE EMPLEADO ---" -ForegroundColor Yellow
    $cacheDir = Join-Path $env:LOCALAPPDATA "COPOWER_INVENTARIO_CACHE"
    $cacheFile = Join-Path $cacheDir "empleado.json"
    $empleadoPrevio = $null
    try {
        if (Test-Path $cacheFile) {
            $empleadoPrevio = Get-Content $cacheFile -Raw | ConvertFrom-Json
        }
    } catch {
        $empleadoPrevio = $null
    }

    $correoEmpleado = $null
    if ($empleadoPrevio -and $empleadoPrevio.correo) {
        Write-Host "Empleado anterior detectado: $($empleadoPrevio.correo)" -ForegroundColor Gray
        $usarPrevio = Read-Host "¿Usar empleado anterior? (Enter=Si, n=No)"
        if ($usarPrevio.Trim() -eq "" -or $usarPrevio.Trim().ToLower() -eq 's') {
            $correoEmpleado = $empleadoPrevio.correo.Trim()
        }
    }

    if (-not $correoEmpleado) {
        $correoEmpleado = Read-Host "Correo empresarial del empleado (o Enter para dejar sin asignar)"
        if ($correoEmpleado.Trim() -eq "") { $correoEmpleado = $null }
    }

    # Guardar cache del empleado
    try {
        if ($correoEmpleado) {
            if (!(Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir | Out-Null }
            $cacheObj = @{ correo = $correoEmpleado }
            $cacheObj | ConvertTo-Json -Depth 3 | Set-Content -Path $cacheFile -Encoding UTF8
        }
    } catch {
        # No bloquear flujo del inventario si falla el cache
    }

    # ---- Confirmacion ----
    Write-Host ""
    Write-Host "--- RESUMEN ---" -ForegroundColor Cyan
    Write-Host "Marca:        $marca"
    Write-Host "Modelo:       $modelo"
    Write-Host "Serial:       $serial"
    Write-Host "IMEI:         $(if ($imei) { $imei } else { '(no ingresado)' })"
    Write-Host "No. Linea:    $(if ($numeroLinea) { $numeroLinea } else { '(no ingresado)' })"
    Write-Host "Empleado:     $(if ($correoEmpleado) { $correoEmpleado } else { '(sin asignar)' })"
    Write-Host ""
    Read-Host "Presione Enter para enviar o Ctrl+C para cancelar"

    # ---- Envio ----
    $Payload = @{
        serial          = $serial
        marca           = if ($marca) { $marca } else { $null }
        modelo          = if ($modelo) { $modelo } else { $null }
        imei            = $imei
        numero_linea    = $numeroLinea
        correo_empleado = $correoEmpleado
    }

    $JsonPayload = $Payload | ConvertTo-Json -Depth 5 -Compress
    $respuesta = Invoke-RestMethod -Uri $UrlEndpoint -Method Post -Body $JsonPayload -ContentType "application/json"

    Clear-Host
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "   CELULAR REGISTRADO CORRECTAMENTE" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "Serial: $serial" -ForegroundColor Cyan
    Write-Host "Equipo: $marca $modelo" -ForegroundColor Cyan
    if ($imei) { Write-Host "IMEI:   $imei" -ForegroundColor Cyan }
    if ($numeroLinea) { Write-Host "Linea:  $numeroLinea" -ForegroundColor Cyan }
    if ($correoEmpleado) {
        Write-Host "Asignado a: $correoEmpleado" -ForegroundColor Cyan
    }

} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
