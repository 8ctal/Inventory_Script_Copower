[CmdletBinding()]
param (
    [Parameter(Mandatory=1, Position=0)]
    [String]
    $SerialNumber
)

function Get-TypeInfo {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory=1, Position=0)]
        [String]
        $SerialNumber
    )
    # Añadimos [0] para tomar el primer resultado antes de expandir el nombre
    $ResponseJson = Invoke-WebRequest -Uri "https://pcsupport.lenovo.com/us/en/api/v4/mse/getproducts?productId=$SerialNumber" | Select-Object -ExpandProperty Content | ConvertFrom-Json

    $TypeText = $ResponseJson[0].Name  # Accedemos al primer elemento de la lista

    $TypeNumber = ($TypeText -split 'Type ')[1]
    $TypeName = ($TypeText -split ' - ')[0]

    return [PSCustomObject]@{
        SerialNumber = $SerialNumber
        FullType = $TypeText
        TypeNumber = $TypeNumber
        TypeName = $TypeName

    }
}

function Get-WarrantyEnd {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory=1, Position=0)]
        [String]
        $SerialNumber
    )

    $Asset = Get-TypeInfo ($SerialNumber)

    $data = @{"serialNumber"="$($Asset.SerialNumber)"; "machineType"="$($Asset.TypeNumber)"; "country"="us"; "language"="en" }
    $json = $data | ConvertTo-Json

    $Response = Invoke-WebRequest -Uri "https://pcsupport.lenovo.com/us/en/api/v4/upsell/redport/getIbaseInfo" `
        -Method Post `
        -Headers @{
            "User-Agent"="Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
            "Accept"="application/json, text/plain, */*";
            "Accept-Language"="en-US,en;q=0.5";
            "Content-Type"="application/json"} `
        -Body $json | Select-Object -ExpandProperty Content

    $WarrantyStart = $Response | ConvertFrom-Json | Select-Object -ExpandProperty Data | Select-Object -ExpandProperty baseWarranties | Select-Object -ExpandProperty startDate

    $WarrantyEnd = $Response | ConvertFrom-Json | Select-Object -ExpandProperty Data | Select-Object -ExpandProperty baseWarranties | Select-Object -ExpandProperty EndDate

    $Product = $Response | ConvertFrom-Json | Select-Object -ExpandProperty Data | Select-Object -ExpandProperty machineInfo | Select-Object -ExpandProperty product

    $Model = $Response | ConvertFrom-Json | Select-Object -ExpandProperty Data | Select-Object -ExpandProperty machineInfo | Select-Object -ExpandProperty model

    $Asset | Add-Member -MemberType NoteProperty -Name "WarrantyStart" -Value $WarrantyStart
    $Asset | Add-Member -MemberType NoteProperty -Name "WarrantyEnd" -Value $WarrantyEnd
    $Asset | Add-Member -MemberType NoteProperty -Name "Product" -Value $Product
    $Asset | Add-Member -MemberType NoteProperty -Name "Model" -Value $Model

    $Asset
}

Get-WarrantyEnd ($SerialNumber)