<#
.SYNOPSIS
    Script para registrar monitores en el sistema de inventario.
.DESCRIPTION
    Detecta monitores externos conectados via Win32_PnPEntity, intenta extraer
    el serial/modelo del PNPDeviceID, y permite al técnico confirmar o editar
    los datos antes de enviarlos al servidor.
#>

$UrlEndpoint = "http://192.168.20.5:3000/api/monitor"
$ResolveEndpoint = "http://192.168.20.5:3000/api/monitor_resolve"

function Get-CopowerWmiMonitors {
    # Same source as monitors_impl: WmiMonitorID (correct serial / internal codes vs PnP)
    $Normalize = {
        param([int[]]$In)
        if ($null -eq $In) { return '' }
        $s = ($In | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }) -join ''
        # Neon/UTF-8 rejects char NUL; strip any leftover
        return ($s.Replace([char]0, '')).Trim()
    }
    $list = @()
    try {
        Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction Stop | ForEach-Object {
            if ($_.Active) {
                $list += [PSCustomObject]@{
                    Manufacturer = (& $Normalize $_.ManufacturerName)
                    Model        = (& $Normalize $_.UserFriendlyNames)
                    ProductCode  = (& $Normalize $_.ProductCodeID)
                    Serial       = (& $Normalize $_.SerialNumberID)
                }
            }
        }
    } catch {
        # WMI may be unavailable on some hosts
    }
    return @($list)
}

function Parse-MonitorPnP {
    param([string]$PnpId)
    # Formato típico: MONITOR\<MARCA><MODELO>\<SERIAL_Y_INSTANCIA>
    # Ej: MONITOR\DELA0EC\4&1A2B3C4D&0&UID257
    $parts = $PnpId -split "\\"
    $result = @{ Marca = ""; Modelo = ""; Serial = ""; RawId = $PnpId }

    if ($parts.Count -ge 2) {
        $deviceCode = $parts[1]  # Ej: DELA0EC  (DEL = Dell, A0EC = codigo modelo)
        # Los primeros 3 caracteres suelen ser el codigo del fabricante
        if ($deviceCode.Length -ge 3) {
            $result.Marca  = $deviceCode.Substring(0, 3)
            $result.Modelo = $deviceCode.Substring(3)
        }
    }
    if ($parts.Count -ge 3) {
        # El tercer segmento contiene el serial embebido al inicio (antes del &)
        $serialTokens = ($parts[2] -split "&") | Where-Object { $_ -and $_.Trim() -ne '' }

        # En muchos casos el primer token es la instancia (ej: '4') y el siguiente token contiene el ID real (ej: '2F225CD1')
        # Por eso preferimos el primer token que tenga al menos una letra (A-Z).
        $alphaToken = $serialTokens | Where-Object { $_ -match '[A-Za-z]' } | Select-Object -First 1
        $fallbackToken = $serialTokens | Select-Object -First 1

        $chosen = $null
        if ($alphaToken) { $chosen = $alphaToken } else { $chosen = $fallbackToken }
        if ($chosen) {
            $result.Serial = $chosen.Trim()
        }
    }
    return $result
}

try {
    $numRegistro = 0
    $correoSesion = $null

    do {
        $numRegistro++
        Clear-Host
        Write-Host "==========================================" -ForegroundColor Cyan
        Write-Host "   INVENTARIO DE MONITORES" -ForegroundColor Cyan
        if ($numRegistro -gt 1) {
            Write-Host "   (Registro #$numRegistro)" -ForegroundColor DarkCyan
        }
        Write-Host "==========================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Detectando monitores (WMI + PnP)..." -ForegroundColor Yellow

        $datosMonitor = @{
            Marca                = ""
            Modelo               = ""
            Serial               = ""
            IdHardware           = ""
            ReferenciaComercial  = $null
        }
        $usedWmiPath = $false

        # --- 1) WMI: serial y codigos internos correctos (recomendado) ---
        $wmiMonitors = @(Get-CopowerWmiMonitors)
        if ($wmiMonitors.Count -gt 0) {
            Write-Host ""
            Write-Host "Monitores (WMI - una fila por dispositivo):" -ForegroundColor Green
            $wmiFilas = @()
            for ($wi = 0; $wi -lt $wmiMonitors.Count; $wi++) {
                $wm = $wmiMonitors[$wi]
                $wmiFilas += [PSCustomObject]@{
                    '#'           = ($wi + 1)
                    Marca         = $wm.Manufacturer
                    'Modelo WMI'  = $wm.Model
                    ProductCode   = $wm.ProductCode
                    Serial        = $wm.Serial
                }
            }
            $wmiFilas | Format-Table -AutoSize -Wrap
            Write-Host ""
            $wSel = Read-Host "Seleccione numero WMI (recomendado) o 0 para solo usar lista PnP"
            if ($wSel -ne "0" -and $wSel -match '^\d+$' -and [int]$wSel -ge 1 -and [int]$wSel -le $wmiMonitors.Count) {
                $w = $wmiMonitors[[int]$wSel - 1]
                $usedWmiPath = $true
                $datosMonitor.Serial = $w.Serial.Trim()
                try {
                    $resolveBody = @{
                        manufacturer = $w.Manufacturer
                        model        = $w.Model
                        productCode  = $w.ProductCode
                    } | ConvertTo-Json -Depth 5 -Compress
                    $resolved = Invoke-RestMethod -Uri $ResolveEndpoint -Method Post -Body $resolveBody -ContentType "application/json"
                    $datosMonitor.Marca = $resolved.brand_display
                    if ($resolved.commercial_model) {
                        $datosMonitor.Modelo = $resolved.commercial_model
                    } elseif ($w.Model) {
                        $datosMonitor.Modelo = $w.Model.Trim()
                    }
                    $datosMonitor.ReferenciaComercial = $resolved.reference_code
                    Write-Host ""
                    Write-Host "Resolucion modelo comercial: $($datosMonitor.Modelo) | ref: $($datosMonitor.ReferenciaComercial) | desde cache: $($resolved.from_cache)" -ForegroundColor Gray
                    if ($resolved.official_url) {
                        Write-Host "  Fuente: $($resolved.official_url)" -ForegroundColor DarkGray
                    }
                } catch {
                    Write-Host ""
                    Write-Host "ADVERTENCIA: No se pudo llamar a /api/monitor_resolve: $($_.Exception.Message)" -ForegroundColor Yellow
                    Write-Host "Se usan datos WMI crudos (marca codigo + modelo interno)." -ForegroundColor Yellow
                    $datosMonitor.Marca = $w.Manufacturer
                    $datosMonitor.Modelo = if ($w.Model) { $w.Model.Trim() } else { "" }
                }
            }
        } else {
            Write-Host "WMI no devolvio monitores activos (se usara PnP si existe)." -ForegroundColor DarkYellow
        }

        # --- 2) PnP: id_hardware y/o fallback marca/modelo/serial ---
        # Forzar array: con 1 solo monitor Win32_PnPEntity no tiene .Count y rompe la lista de opciones
        $rawPnp = @(Get-CimInstance Win32_PnPEntity | Where-Object {
            $_.Service -eq "monitor" -and $_.Caption
        })
        $monitores = @(
            foreach ($rp in $rawPnp) {
                [PSCustomObject]@{
                    Nombre     = $rp.Caption
                    Estado     = $rp.Status
                    PNPDeviceID = $rp.PNPDeviceID
                }
            }
        )

        $monitorSeleccionado = $null
        if ($monitores.Count -eq 0) {
            Write-Host ""
            Write-Host "No se detectaron monitores PnP." -ForegroundColor Red
            if (-not $usedWmiPath) {
                Write-Host "Ingresara los datos manualmente." -ForegroundColor Yellow
            }
            Write-Host ""
        } else {
            Write-Host ""
            Write-Host "Monitores PnP (una fila por dispositivo - id_hardware / fallback):" -ForegroundColor Green
            $pnpFilas = @()
            for ($pi = 0; $pi -lt $monitores.Count; $pi++) {
                $m = $monitores[$pi]
                $pnpFilas += [PSCustomObject]@{
                    '#'     = ($pi + 1)
                    Nombre  = $m.Nombre
                    'PNP ID' = $m.PNPDeviceID
                }
            }
            $pnpFilas | Format-Table -AutoSize -Wrap
            Write-Host ""
            if ($usedWmiPath) {
                $seleccion = Read-Host "Seleccione el mismo monitor en PnP para guardar id_hardware (0 omitir)"
            } else {
                $seleccion = Read-Host "Seleccione el numero del monitor a registrar (o 0 para ingresar manualmente)"
            }

            if ($seleccion -ne "0" -and $seleccion -match '^\d+$' -and [int]$seleccion -ge 1 -and [int]$seleccion -le $monitores.Count) {
                $monitorSeleccionado = $monitores[[int]$seleccion - 1]
            }
        }

        if ($monitorSeleccionado) {
            $parsed = Parse-MonitorPnP -PnpId $monitorSeleccionado.PNPDeviceID
            $datosMonitor.IdHardware = $parsed.RawId
            if (-not $usedWmiPath) {
                $datosMonitor.Marca  = $parsed.Marca
                $datosMonitor.Modelo = $parsed.Modelo
                $datosMonitor.Serial = $parsed.Serial
            }
        }

    # ---- Mostrar información recolectada (solo referencia) ----
    Write-Host ""
    Write-Host "--- INFORMACION RECOLECTADA (referencia) ---" -ForegroundColor Yellow
    Write-Host "Marca:    $($datosMonitor.Marca)" -ForegroundColor White
    Write-Host "Modelo:   $($datosMonitor.Modelo)" -ForegroundColor White
    Write-Host "Serial:   $($datosMonitor.Serial)" -ForegroundColor White
    Write-Host "Ref.com.: $($datosMonitor.ReferenciaComercial)" -ForegroundColor White
    Write-Host "Hardware: $($datosMonitor.IdHardware)" -ForegroundColor White

    # ---- Carga manual ----
    Write-Host ""
    Write-Host "--- CARGA MANUAL DE DATOS DEL MONITOR ---" -ForegroundColor Yellow
    Write-Host ""

    $marcaInput = Read-Host "Marca (referencia: '$($datosMonitor.Marca)') (Enter para omitir)"
    if ($marcaInput.Trim() -eq "") {
        $datosMonitor.Marca = $null
    } else {
        $datosMonitor.Marca = $marcaInput.Trim()
    }

    $modeloInput = Read-Host "Modelo (referencia: '$($datosMonitor.Modelo)') (Enter para omitir)"
    if ($modeloInput.Trim() -eq "") {
        $datosMonitor.Modelo = $null
    } else {
        $datosMonitor.Modelo = $modeloInput.Trim()
    }

    # Para que la carga de imagen a Odoo funcione, necesitamos un modelo no-vacío
    while (-not $datosMonitor.Modelo -or $datosMonitor.Modelo.Trim() -eq "") {
        Write-Host "Modelo requerido para buscar imagen en Cloudinary/Serper." -ForegroundColor Red
        $modeloInput = Read-Host "Ingrese Modelo (ej: A0EC)"
        if ($modeloInput.Trim() -ne "") {
            $datosMonitor.Modelo = $modeloInput.Trim()
        }
    }

    while ($true) {
        $serialInput = Read-Host "Serial (referencia: '$($datosMonitor.Serial)') (Enter para usar referencia)"
        if ($serialInput.Trim() -eq "") {
            if ($datosMonitor.Serial -and $datosMonitor.Serial.Trim() -ne "") {
                break
            }
            Write-Host "ERROR: El serial es obligatorio (no se detecto referencia). Intenta de nuevo." -ForegroundColor Red
            continue
        }

        $datosMonitor.Serial = $serialInput.Trim()
        break
    }

    # ---- Empleado ----
    # Cache local para reutilizar el mismo empleado entre PC/Monitor/Celular
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

    Write-Host ""
    Write-Host "--- ASIGNACION DE EMPLEADO ---" -ForegroundColor Yellow
    $correoEmpleado = $null
    if ($correoSesion) {
        Write-Host "Empleado usado en este mismo script: $correoSesion" -ForegroundColor Gray
        $mantenerSesion = Read-Host "¿Mantener el mismo empleado para este monitor? (Enter=Si, n=cambiar)"
        if ($mantenerSesion.Trim() -eq "" -or $mantenerSesion.Trim().ToLower() -eq 's') {
            $correoEmpleado = $correoSesion
        }
    }
    if (-not $correoEmpleado -and $empleadoPrevio -and $empleadoPrevio.correo) {
        Write-Host "Empleado en cache (PC/script previo): $($empleadoPrevio.correo)" -ForegroundColor Gray
        $usarPrevio = Read-Host "¿Usar empleado del cache? (Enter=Si, n=No)"
        if ($usarPrevio.Trim() -eq "" -or $usarPrevio.Trim().ToLower() -eq 's') {
            $correoEmpleado = $empleadoPrevio.correo.Trim()
        }
    }

    if (-not $correoEmpleado) {
        $correoEmpleado = Read-Host "Correo empresarial del empleado (o Enter para dejar sin asignar)"
        if ($correoEmpleado.Trim() -eq "") { $correoEmpleado = $null }
    }

    # Guardar cache del empleado para reutilizarlo en el siguiente dispositivo
    try {
        if ($correoEmpleado) {
            if (!(Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir | Out-Null }
            $cacheObj = @{ correo = $correoEmpleado }
            $cacheObj | ConvertTo-Json -Depth 3 | Set-Content -Path $cacheFile -Encoding UTF8
        }
    } catch {
        # Si falla el cache, no bloqueamos el flujo del inventario
    }

    # ---- Confirmacion ----
    Write-Host ""
    Write-Host "--- RESUMEN ---" -ForegroundColor Cyan
    Write-Host "Marca:    $($datosMonitor.Marca)"
    Write-Host "Modelo:   $($datosMonitor.Modelo)"
    Write-Host "Serial:   $($datosMonitor.Serial)"
    Write-Host "Ref.com.: $($datosMonitor.ReferenciaComercial)"
    Write-Host "Hardware: $($datosMonitor.IdHardware)"
    Write-Host "Empleado: $(if ($correoEmpleado) { $correoEmpleado } else { '(sin asignar)' })"
    Write-Host ""
    Read-Host "Presione Enter para enviar o Ctrl+C para cancelar"

    # ---- Envio ----
    $Payload = @{
        serial                = $datosMonitor.Serial
        marca                 = $datosMonitor.Marca
        modelo                = $datosMonitor.Modelo
        referencia_comercial  = $datosMonitor.ReferenciaComercial
        id_hardware           = $(if ([string]::IsNullOrWhiteSpace($datosMonitor.IdHardware)) { $null } else { $datosMonitor.IdHardware.Trim() })
        correo_empleado       = $correoEmpleado
    }

    $JsonPayload = $Payload | ConvertTo-Json -Depth 5 -Compress
    $respuesta = Invoke-RestMethod -Uri $UrlEndpoint -Method Post -Body $JsonPayload -ContentType "application/json"

    Clear-Host
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "   MONITOR REGISTRADO CORRECTAMENTE" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "Serial: $($datosMonitor.Serial)" -ForegroundColor Cyan
    Write-Host "Marca:  $($datosMonitor.Marca) $($datosMonitor.Modelo)" -ForegroundColor Cyan
    if ($correoEmpleado) {
        Write-Host "Asignado a: $correoEmpleado" -ForegroundColor Cyan
        $correoSesion = $correoEmpleado
    }

    Write-Host ""
    $registrarOtro = Read-Host "¿Registrar otro monitor? (s/n; Enter=n)"
    } while ($registrarOtro.Trim().ToLower() -eq 's' -or $registrarOtro.Trim().ToLower() -eq 'si')

} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
