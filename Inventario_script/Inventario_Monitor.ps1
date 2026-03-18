<#
.SYNOPSIS
    Script para registrar monitores en el sistema de inventario.
.DESCRIPTION
    Detecta monitores externos conectados via Win32_PnPEntity, intenta extraer
    el serial/modelo del PNPDeviceID, y permite al técnico confirmar o editar
    los datos antes de enviarlos al servidor.
#>

$UrlEndpoint = "http://192.168.20.5:3000/api/monitor"

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
        $serialSegment = $parts[2] -split "&" | Select-Object -First 1
        if ($serialSegment -and $serialSegment -notmatch "^\d+$") {
            $result.Serial = $serialSegment
        }
    }
    return $result
}

try {
    Clear-Host
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "   INVENTARIO DE MONITORES" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Detectando monitores externos..." -ForegroundColor Yellow

    # Obtener monitores, excluir los integrados/genéricos
    $monitores = Get-CimInstance Win32_PnPEntity | Where-Object {
        $_.Service -eq "monitor" -and
        $_.Caption -notmatch "Integrado|Integrated|Internal|Generic|PnP|ACPI"
    } | Select-Object @{N="Nombre"; E={$_.Caption}},
                      @{N="Estado"; E={$_.Status}},
                      @{N="PNPDeviceID"; E={$_.PNPDeviceID}}

    if (-not $monitores -or $monitores.Count -eq 0) {
        Write-Host "No se detectaron monitores externos." -ForegroundColor Red
        Write-Host "Ingresara los datos manualmente." -ForegroundColor Yellow
        Write-Host ""
        $monitorSeleccionado = $null
    } else {
        Write-Host ""
        Write-Host "Monitores detectados:" -ForegroundColor Green
        $i = 1
        foreach ($m in $monitores) {
            Write-Host "  [$i] $($m.Nombre)" -ForegroundColor White
            Write-Host "      ID: $($m.PNPDeviceID)" -ForegroundColor Gray
            $i++
        }
        Write-Host ""
        $seleccion = Read-Host "Seleccione el numero del monitor a registrar (o 0 para ingresar manualmente)"
        
        if ($seleccion -eq "0" -or [int]$seleccion -gt $monitores.Count) {
            $monitorSeleccionado = $null
        } else {
            $monitorSeleccionado = $monitores[[int]$seleccion - 1]
        }
    }

    # Pre-poblar datos si se seleccionó un monitor detectado
    $datosMonitor = @{ Marca = ""; Modelo = ""; Serial = ""; IdHardware = "" }
    
    if ($monitorSeleccionado) {
        $parsed = Parse-MonitorPnP -PnpId $monitorSeleccionado.PNPDeviceID
        $datosMonitor.Marca      = $parsed.Marca
        $datosMonitor.Modelo     = $parsed.Modelo
        $datosMonitor.Serial     = $parsed.Serial
        $datosMonitor.IdHardware = $parsed.RawId
    }

    # ---- Formulario editable ----
    Write-Host ""
    Write-Host "--- DATOS DEL MONITOR (Editable) ---" -ForegroundColor Yellow
    Write-Host ""

    Write-Host "Marca (actual: '$($datosMonitor.Marca)')" -ForegroundColor White
    $input = Read-Host "Presione Enter para mantener o escriba la marca"
    if ($input.Trim() -ne "") { $datosMonitor.Marca = $input.Trim() }

    Write-Host "Modelo (actual: '$($datosMonitor.Modelo)')" -ForegroundColor White
    $input = Read-Host "Presione Enter para mantener o escriba el modelo"
    if ($input.Trim() -ne "") { $datosMonitor.Modelo = $input.Trim() }

    Write-Host "Serial (actual: '$($datosMonitor.Serial)')" -ForegroundColor White
    $input = Read-Host "Presione Enter para mantener o escriba el serial"
    if ($input.Trim() -ne "") { $datosMonitor.Serial = $input.Trim() }

    if (-not $datosMonitor.Serial -or $datosMonitor.Serial -eq "") {
        Write-Host "ERROR: El serial es obligatorio." -ForegroundColor Red
        exit 1
    }

    # ---- Empleado ----
    Write-Host ""
    Write-Host "--- ASIGNACION DE EMPLEADO ---" -ForegroundColor Yellow
    $correoEmpleado = Read-Host "Correo empresarial del empleado (o Enter para dejar sin asignar)"
    if ($correoEmpleado.Trim() -eq "") { $correoEmpleado = $null }

    # ---- Confirmacion ----
    Write-Host ""
    Write-Host "--- RESUMEN ---" -ForegroundColor Cyan
    Write-Host "Marca:    $($datosMonitor.Marca)"
    Write-Host "Modelo:   $($datosMonitor.Modelo)"
    Write-Host "Serial:   $($datosMonitor.Serial)"
    Write-Host "Hardware: $($datosMonitor.IdHardware)"
    Write-Host "Empleado: $(if ($correoEmpleado) { $correoEmpleado } else { '(sin asignar)' })"
    Write-Host ""
    Read-Host "Presione Enter para enviar o Ctrl+C para cancelar"

    # ---- Envio ----
    $Payload = @{
        serial          = $datosMonitor.Serial
        marca           = $datosMonitor.Marca
        modelo          = $datosMonitor.Modelo
        id_hardware     = $datosMonitor.IdHardware
        correo_empleado = $correoEmpleado
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
    }

} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
