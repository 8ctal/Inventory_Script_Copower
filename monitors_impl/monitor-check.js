const { exec } = require('child_process');
const axios = require('axios');

// CONFIGURACIÓN
const SERPER_API_KEY = '34f2ff0cc51510de8e9bb86072918656f3b68319';

// 1. Mapeo extendido de fabricantes
const VENDOR_MAP = {
    'SAM': 'Samsung',
    'LEN': 'Lenovo',
    'DEL': 'Dell',
    'GSM': 'LG',
    'ACI': 'ASUS',
    'HPQ': 'HP',
    'HPN': 'HP',
    'BOE': 'Lenovo BOE',
    'AOC': 'AOC',
    'PHL': 'Philips'
};

const BLACKLIST = [
    'SOLUTIONS', 'MONITORS', 'SUPPORT', 'PRODUCTS',
    'GLOBAL', 'INDEX', 'FLAT', 'PAGES', 'SPEC', 'PRODUCT'
];

// Extraer modelo desde URL
function extractModelFromUrl(url) {
    const cleanUrl = url.split('?')[0].replace(/\/$/, "");
    const segments = cleanUrl.split('/');

    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i].toUpperCase();

        if (
            segment.length >= 7 &&
            /[0-9]/.test(segment) &&
            /[A-Z]/.test(segment) &&
            !BLACKLIST.includes(segment)
        ) {
            return segment;
        }
    }
    return 'Ver URL';
}

// Buscar specs en Google (Serper)
async function searchMonitorSpecs(monitor) {
    const brand = VENDOR_MAP[monitor.Manufacturer] || monitor.Manufacturer;

    const query = `${brand} monitor ${monitor.Model} ${monitor.ProductCode} official model code`.trim();

    try {
        const response = await axios.post(
            'https://google.serper.dev/search',
            {
                q: query,
                gl: 'co',
                hl: 'es'
            },
            {
                headers: {
                    'X-API-KEY': SERPER_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        const results = response.data.organic || [];

        const official = results.find(res =>
            res.link.includes('samsung.com') ||
            res.link.includes('lenovo.com') ||
            res.link.includes('dell.com') ||
            res.link.includes('hp.com') ||
            res.link.includes('lg.com')
        ) || results[0];

        if (official) {
            return {
                fullModel: extractModelFromUrl(official.link),
                link: official.link,
                title: official.title
            };
        }

        return { fullModel: 'No encontrado', link: '#' };

    } catch (e) {
        return { fullModel: 'Error en búsqueda', link: '#' };
    }
}

// Script PowerShell
const psCommand = `
$GetNormalized = {
    param([int[]]$In)
    ($In | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }) -join ''
}

Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID | ForEach-Object {
    [PSCustomObject]@{
        Manufacturer = & $GetNormalized $_.ManufacturerName
        Model        = & $GetNormalized $_.UserFriendlyNames
        ProductCode  = & $GetNormalized $_.ProductCodeID
        Serial       = & $GetNormalized $_.SerialNumberID
        Active       = $_.Active
    }
} | ConvertTo-Json
`;

console.log("🔍 Detectando monitores conectados...");

// 👉 Convertimos a Base64 (UTF-16LE requerido por PowerShell)
const encoded = Buffer.from(psCommand, 'utf16le').toString('base64');

exec(`powershell -EncodedCommand ${encoded}`, async (error, stdout, stderr) => {
    if (error) {
        console.error(`❌ Error ejecutando PowerShell: ${error.message}`);
        return;
    }

    try {
        let monitors = JSON.parse(stdout);

        if (!Array.isArray(monitors)) {
            monitors = [monitors];
        }

        console.log(`✅ Se encontraron ${monitors.length} monitores.\n`);

        for (const mon of monitors) {
            if (!mon.Active) continue;

            const details = await searchMonitorSpecs(mon);

            console.log(`--------------------------------------------------`);
            console.log(`📡 HARDWARE: ${mon.Manufacturer} | ID: ${mon.ProductCode}`);
            console.log(`🏷️  MODELO: ${details.fullModel}`);
            console.log(`🔗 LINK: ${details.link}`);
            console.log(`📝 TÍTULO: ${details.title}`);
            console.log(`🔢 SERIAL: ${mon.Serial}`);
        }

    } catch (parseError) {
        console.error("❌ Error parseando JSON:", parseError);
        console.error("Salida cruda:", stdout);
    }
});