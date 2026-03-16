[CmdletBinding()]
param (
    [Parameter(Mandatory = 1, Position = 0)]
    [String]$SerialNumber
)

# Forzamos TLS 1.2 para asegurar la conexión con las APIs modernas
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-TypeInfo {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = 1, Position = 0)]
        [String]$SerialNumber
    )

    try {
        $headers = @{ "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        $url = "https://pcsupport.lenovo.com/us/en/api/v4/mse/getproducts?productId=$SerialNumber"
        
        $Response = Invoke-RestMethod -Uri $url -Method Get -Headers $headers -ErrorAction Stop

        if ($null -eq $Response -or $Response.Count -eq 0) {
            return $null
        }

        # Almacenamos toda la línea de texto extraída sin procesar (sin regex ni splits)
        return [PSCustomObject]@{
            SerialNumber = $SerialNumber
            FullType     = $Response[0].Name
        }
    }
    catch {
        return $null
    }
}

function Get-WarrantyEnd {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = 1, Position = 0)]
        [String]$SerialNumber
    )

    # Obtenemos primero la información del producto
    $Asset = Get-TypeInfo -SerialNumber $SerialNumber

    if (-not $Asset) {
        return $null
    }

    # Cuerpo simplificado: Solo Serial, sin usar MachineType para la búsqueda
    $data = @{
        "serialNumber" = "$($Asset.SerialNumber)"
        "country"      = "us"
        "language"     = "en" 
    }
    $jsonBody = $data | ConvertTo-Json -Compress

    try {
        $Uri = "https://pcsupport.lenovo.com/us/en/api/v4/upsell/redport/getIbaseInfo"
        $Headers = @{
            "User-Agent"      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"
            "Accept"          = "application/json, text/plain, */*"
            "Accept-Language" = "en-US,en;q=0.5"
            "Content-Type"    = "application/json"
            "Referer"         = "https://pcsupport.lenovo.com/"
        }

        $ResponseObj = Invoke-RestMethod -Uri $Uri -Method Post -Headers $Headers -Body $jsonBody

        if (-not $ResponseObj -or -not $ResponseObj.Data) {
            return $null
        }

        # Extraemos los datos de la respuesta
        $WarrantyStart = $ResponseObj.Data.baseWarranties[0].startDate
        $WarrantyEnd = $ResponseObj.Data.baseWarranties[0].endDate
        $Product = $ResponseObj.Data.machineInfo.product
        $Model = $ResponseObj.Data.machineInfo.model

        # Añadimos los miembros al objeto original
        $Asset | Add-Member -MemberType NoteProperty -Name "WarrantyStart" -Value $WarrantyStart -Force
        $Asset | Add-Member -MemberType NoteProperty -Name "WarrantyEnd" -Value $WarrantyEnd -Force
        $Asset | Add-Member -MemberType NoteProperty -Name "Product" -Value $Product -Force
        $Asset | Add-Member -MemberType NoteProperty -Name "Model" -Value $Model -Force

        return $Asset
    }
    catch {
        return $null
    }
}

# --- Ejecución y salida en formato JSON ---
$Result = Get-WarrantyEnd -SerialNumber $SerialNumber
if ($Result) {
    $Result | ConvertTo-Json -Compress
}
else {
    Write-Error "No se pudo obtener información para el serial: $SerialNumber"
}