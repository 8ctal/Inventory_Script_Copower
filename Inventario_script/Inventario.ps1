<#
.SYNOPSIS
    Script de Inventario de Hardware para envo a API/Base de Datos
.DESCRIPTION
    Recopila informacin del sistema (Host, Serial, RAM, Disco, IP) y la enva va POST.
#>

# ---------------- CONFIGURACIN ----------------
# Aqu pondremos la direccin de tu "servidor" o Google Sheet ms adelante.
# Por ahora, dejaremos esto pendiente.
$UrlEndpoint = "http://192.168.20.5:3000/api/inventario" 

try {
    Write-Host "--- RECOPILANDO INFORMACIN (Espere un momento...) ---" -ForegroundColor Cyan
    
    # 1. Hardware y Sistema
    $os = Get-CimInstance Win32_OperatingSystem
    $compSystem = Get-CimInstance Win32_ComputerSystem
    $bios = Get-CimInstance Win32_BIOS
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $ramModules = Get-CimInstance Win32_PhysicalMemory
    
    # Clculo seguro de RAM
    $totalRamGB = 0
    if ($ramModules) {
        $totalRamGB = [math]::Round(($ramModules.Capacity | Measure-Object -Sum).Sum / 1GB, 2)
    }

    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    
    # 2. Red e IP (Filtro ms robusto)
    $IPAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
            $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Pseudo|Virtual' -and $_.IPAddress -notlike '169.*'
        } | Select-Object -First 1).IPAddress
    if (!$IPAddress) { $IPAddress = "N/A" }

    # 3. Usuarios y Dominio
    $localUsers = (Get-CimInstance Win32_UserAccount -Filter "LocalAccount=True").Name -join ", "
    
    # 3.1. Empleado actual (usuario local que está usando la máquina)
    # Solo se guarda el empleado actual, no todos los usuarios locales
    $empleadoActual = @{
        nombre             = $env:USERNAME  # Nombre del usuario local actual
        correo_empresarial = $null
        numero_empresarial = $null
        area               = $null
        cargo              = $null
    }
    
    # Timestamp de la máquina local (formato ISO 8601)
    $timestampMachine = [System.TimeZoneInfo]::ConvertTime((Get-Date), [System.TimeZoneInfo]::FindSystemTimeZoneById("SA Pacific Standard Time")).ToString("yyyy-MM-dd HH:mm:ss")

    # 4. Software (Manejo de errores si la lista es nula)
    $appsList = "No detectado"
    try {
        $apps = Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue | 
        Where-Object { $_.DisplayName -ne $null } | Select-Object -Unique DisplayName
        if ($apps) { $appsList = ($apps.DisplayName) -join " | " }
    }
    catch { $appsList = "Error al leer registro" }

    # 5. Cuentas de Correo
    $emailList = "Ninguna detectada"
    try {
        $emails = (Get-ChildItem -Path "HKCU:\Software\Microsoft\IdentityCRL\UserExtendedProperties" -ErrorAction SilentlyContinue).Name | 
        ForEach-Object { Split-Path $_ -Leaf }
        if ($emails) { $emailList = $emails -join ", " }
    }
    catch { }

    # 6. Licencia (ESTA ERA LA PARTE DEL ERROR)
    $estadoLicencia = "Desconocido"
    try {
        $licenseObj = Get-CimInstance SoftwareLicensingProduct | Where-Object { $_.PartialProductKey -and $_.ApplicationID -eq "55c282d3-052d-4a11-841d-2746af130b4d" }
        if ($licenseObj) {
            $statusMap = @{ 1 = "Licenciado"; 2 = "OOBGrace"; 3 = "OOTGrace"; 4 = "NonGenuineGrace"; 5 = "NotActivated"; 0 = "Unlicensed" }
            $statusVal = $licenseObj.LicenseStatus
            if ($statusMap.ContainsKey([int]$statusVal)) {
                $estadoLicencia = $statusMap[[int]$statusVal]
            }
        }
    }
    catch { $estadoLicencia = "Error al consultar" }

    # Construccin del Payload
    $Payload = @{
        hostname             = $env:COMPUTERNAME
        usuario              = $env:USERNAME
        fabricante           = if ($bios.Manufacturer) { $bios.Manufacturer } else { "N/A" }
        modelo               = if ($compSystem.Model) { $compSystem.Model } else { "N/A" }
        serial               = if ($bios.SerialNumber) { $bios.SerialNumber } else { "N/A" }
        sistema_op           = $os.Caption
        sistema_version      = $os.Version
        ram_gb               = $totalRamGB
        procesador           = $cpu.Name
        disco_total_gb       = [math]::Round($disk.Size / 1GB, 2)
        disco_libre_gb       = [math]::Round($disk.FreeSpace / 1GB, 2)
        dominio              = $compSystem.Domain
        usuarios_locales     = $localUsers
        ip_local             = $IPAddress
        programas_instalados = $appsList
        cuentas_correo       = $emailList
        estado_licencia      = $estadoLicencia
        timestamp_machine    = $timestampMachine
        empleado_actual      = $empleadoActual
    }

    # MOSTRAR DATOS RECOPILADOS Y PERMITIR EDICIN
    Clear-Host
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "   INFORMACIN RECOPILADA DEL EQUIPO" -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Mostrar datos del sistema (solo lectura)
    Write-Host "--- INFORMACIN DEL EQUIPO (Solo lectura) ---" -ForegroundColor Yellow
    Write-Host "Hostname: " -NoNewline -ForegroundColor White
    Write-Host "$($Payload.hostname)" -ForegroundColor Gray
    Write-Host "Serial: " -NoNewline -ForegroundColor White
    Write-Host "$($Payload.serial)" -ForegroundColor Gray
    Write-Host "Fabricante: " -NoNewline -ForegroundColor White
    Write-Host "$($Payload.fabricante)" -ForegroundColor Gray
    Write-Host "Modelo: " -NoNewline -ForegroundColor White
    Write-Host "$($Payload.modelo)" -ForegroundColor Gray
    Write-Host "RAM: " -NoNewline -ForegroundColor White
    Write-Host "$($Payload.ram_gb) GB" -ForegroundColor Gray
    Write-Host "Procesador: " -NoNewline -ForegroundColor White
    Write-Host "$($Payload.procesador)" -ForegroundColor Gray
    Write-Host "IP Local: " -NoNewline -ForegroundColor White
    Write-Host "$($Payload.ip_local)" -ForegroundColor Gray
    Write-Host ""
    
    # Convertir null a string vaco para mostrar correctamente
    if ($null -eq $empleadoActual.correo_empresarial) { $empleadoActual.correo_empresarial = "" }
    if ($null -eq $empleadoActual.numero_empresarial) { $empleadoActual.numero_empresarial = "" }
    if ($null -eq $empleadoActual.area) { $empleadoActual.area = "" }
    if ($null -eq $empleadoActual.cargo) { $empleadoActual.cargo = "" }
    
    # Permitir editar informacin del empleado actual
    Write-Host "--- INFORMACIN DEL EMPLEADO (Editable) ---" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Usuario local actual: $($empleadoActual.nombre)" -ForegroundColor Gray
    Write-Host ""
    
    # Nombre del empleado (se puede editar si es diferente al usuario local)
    Write-Host "Nombre del empleado (actual: '$($empleadoActual.nombre)')" -ForegroundColor White
    Write-Host "Presione Enter para mantener o escriba el nuevo nombre: " -NoNewline -ForegroundColor Gray
    $nuevoNombre = Read-Host
    if ($nuevoNombre.Trim() -ne "") {
        $empleadoActual.nombre = $nuevoNombre.Trim()
    }
    
    # Correo empresarial
    Write-Host "Correo empresarial (actual: '$($empleadoActual.correo_empresarial)')" -ForegroundColor White
    Write-Host "Presione Enter para mantener o escriba el nuevo correo: " -NoNewline -ForegroundColor Gray
    $nuevoCorreo = Read-Host
    if ($nuevoCorreo.Trim() -ne "") {
        $empleadoActual.correo_empresarial = $nuevoCorreo.Trim()
    }
    
    # Nmero empresarial
    Write-Host "Nmero empresarial/Telefono (actual: '$($empleadoActual.numero_empresarial)')" -ForegroundColor White
    Write-Host "Presione Enter para mantener o escriba el nuevo numero: " -NoNewline -ForegroundColor Gray
    $nuevoNumero = Read-Host
    if ($nuevoNumero.Trim() -ne "") {
        $empleadoActual.numero_empresarial = $nuevoNumero.Trim()
    }
    
    # Area
    Write-Host "Area/Departamento (actual: '$($empleadoActual.area)')" -ForegroundColor White
    Write-Host "Presione Enter para mantener o escriba el nuevo area: " -NoNewline -ForegroundColor Gray
    $nuevaArea = Read-Host
    if ($nuevaArea.Trim() -ne "") {
        $empleadoActual.area = $nuevaArea.Trim()
    }
    
    # Cargo
    Write-Host "Cargo/Posicion (actual: '$($empleadoActual.cargo)')" -ForegroundColor White
    Write-Host "Presione Enter para mantener o escriba el nuevo cargo: " -NoNewline -ForegroundColor Gray
    $nuevoCargo = Read-Host
    if ($nuevoCargo.Trim() -ne "") {
        $empleadoActual.cargo = $nuevoCargo.Trim()
    }
    # --- SELECCIÓN DE TIPO DE MOVIMIENTO ---
    Write-Host "--- TIPO DE MOVIMIENTO ---" -ForegroundColor Yellow
    Write-Host "1. Entrega de equipo"
    Write-Host "2. Devolución de equipo"
    $opcion = Read-Host "Seleccione una opción (1 o 2)"

    $tipoMovimiento = if ($opcion -eq "1") { "Entrega" } else { "Devolucion" }

    # Actualizar el payload (asegúrate de incluirlo aquí)
    $Payload.tipo = $tipoMovimiento
    
    Write-Host ""
    Write-Host "--- DATOS PARA ODOO ---" -ForegroundColor Yellow

    # Opciones controladas para mejorar el match con Odoo (cache por nombre)
    $categoriasOpciones = @(
        @{ id = 25; name = 'EQUIPO-DE-COMPUTO' },
        @{ id = 26; name = 'IMPRESORAS' },
        @{ id = 27; name = 'TELEFONO-CELULAR' },
        @{ id = 28; name = 'MONITORES' }
    )
    $proveedorOpciones = @(
        @{ id = 57796; name = 'ACTIVIDADES ECONOMICAS INDUSTRIA Y COMERCIO/ LENOVO' }
    )

    Write-Host "Proveedor del equipo (opcion única):" -ForegroundColor White
    foreach ($p in $proveedorOpciones) {
        Write-Host "  [$($p.id)] $($p.name)" -ForegroundColor Gray
    }
    $proveedorInput = Read-Host "Seleccione proveedor por id (o presione Enter para omitir)"
    if ($proveedorInput.Trim() -ne "") {
        if ($proveedorInput.Trim() -notmatch '^\d+$') {
            Write-Host "Proveedor invalido. Debe seleccionar el id de la opcion." -ForegroundColor Red
            exit 1
        }
        $proveedorSel = $proveedorOpciones | Where-Object { $_.id -eq [int]$proveedorInput.Trim() }
        if (-not $proveedorSel) {
            Write-Host "Proveedor invalido. Id no reconocido." -ForegroundColor Red
            exit 1
        }
        $Payload.proveedor = $proveedorSel.name
    }

    Write-Host "Categoria del equipo (opciones):" -ForegroundColor White
    foreach ($c in $categoriasOpciones) {
        Write-Host "  [$($c.id)] $($c.name)" -ForegroundColor Gray
    }
    $categoriaInput = Read-Host "Seleccione categoria por id (o presione Enter para omitir)"
    if ($categoriaInput.Trim() -ne "") {
        if ($categoriaInput.Trim() -notmatch '^\d+$') {
            Write-Host "Categoria invalida. Debe seleccionar el id de la opcion." -ForegroundColor Red
            exit 1
        }
        $categoriaSel = $categoriasOpciones | Where-Object { $_.id -eq [int]$categoriaInput.Trim() }
        if (-not $categoriaSel) {
            Write-Host "Categoria invalida. Id no reconocido." -ForegroundColor Red
            exit 1
        }
        $Payload.categoria = $categoriaSel.name
    }

    Write-Host ""
    Write-Host "Presione Enter para enviar los datos o Ctrl+C para cancelar..." -ForegroundColor Cyan
    Read-Host
    
    # Convertir strings vacos a null para la base de datos
    if ($empleadoActual.correo_empresarial -eq "") { $empleadoActual.correo_empresarial = $null }
    if ($empleadoActual.numero_empresarial -eq "") { $empleadoActual.numero_empresarial = $null }
    if ($empleadoActual.area -eq "") { $empleadoActual.area = $null }
    if ($empleadoActual.cargo -eq "") { $empleadoActual.cargo = $null }
    
    # Actualizar el payload con los datos editados
    $Payload.empleado_actual = $empleadoActual
    $Payload.usuario = $empleadoActual.correo_empresarial
    
    # Actualizar timestamp antes de enviar
    $Payload.timestamp_machine = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

    # ENVO
    Write-Host ""
    Write-Host "Enviando datos al servidor..." -ForegroundColor Cyan
    $JsonPayload = $Payload | ConvertTo-Json -Depth 10 -Compress
    Invoke-RestMethod -Uri $UrlEndpoint -Method Post -Body $JsonPayload -ContentType "application/json"

    # MOSTRAR RESULTADOS
    Clear-Host
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "   INVENTARIO SINCRONIZADO CORRECTAMENTE" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Equipo: $($Payload.hostname) ($($Payload.serial))" -ForegroundColor Cyan
    Write-Host "Empleado: $($empleadoActual.nombre)" -ForegroundColor Cyan
    if ($empleadoActual.correo_empresarial) {
        Write-Host "Correo: $($empleadoActual.correo_empresarial)" -ForegroundColor Cyan
    }
    if ($empleadoActual.numero_empresarial) {
        Write-Host "Telefono: $($empleadoActual.numero_empresarial)" -ForegroundColor Cyan
    }
    if ($empleadoActual.area) {
        Write-Host "Area: $($empleadoActual.area)" -ForegroundColor Cyan
    }
    if ($empleadoActual.cargo) {
        Write-Host "Cargo: $($empleadoActual.cargo)" -ForegroundColor Cyan
    }
    
    if ($Payload.proveedor) {
        Write-Host "Proveedor: $($Payload.proveedor)" -ForegroundColor Cyan
    }
    if ($Payload.categoria) {
        Write-Host "Categoria: $($Payload.categoria)" -ForegroundColor Cyan
    }
    Write-Host ""
    Write-Host "Programas detectados: $($apps.Count)" -ForegroundColor Gray
    Write-Host "==================================================" -ForegroundColor Green

}
catch {
    Write-Host "Ocurri un error inesperado: $($_.Exception.Message)" -ForegroundColor Red
}
