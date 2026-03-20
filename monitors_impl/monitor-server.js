const axios = require('axios');

const SERPER_API_KEY = '34f2ff0cc51510de8e9bb86072918656f3b68319';

// Palabras que aparecen en las URLs pero NO son modelos
const BLACKLIST = ['SOLUTIONS', 'MONITORS', 'SUPPORT', 'PRODUCTS', 'GLOBAL', 'INDEX', 'FLAT', 'PAGES'];

function extractModelFromUrl(url) {
    // 1. Limpiamos la URL de parámetros de rastreo y slash final
    const cleanUrl = url.split('?')[0].replace(/\/$/, "");
    const segments = cleanUrl.split('/');
    
    // 2. Buscamos en los últimos segmentos (donde suele estar el modelo)
    // Empezamos desde el final hacia atrás
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i].toUpperCase();
        
        // Filtramos: debe tener números y letras, longitud min 7, y no estar en la lista negra
        if (segment.length >= 7 && 
            /[0-9]/.test(segment) && 
            /[A-Z]/.test(segment) && 
            !BLACKLIST.includes(segment)) {
            return segment;
        }
    }
    return 'No detectado';
}

async function findFullModelInfo(monitor) {
    const vendorMap = { 'SAM': 'Samsung', 'LEN': 'Lenovo', 'BOE': 'Lenovo BOE' };
    const brand = vendorMap[monitor.Manufacturer] || monitor.Manufacturer;
    
    // Agregamos "S/N" o "Model Code" a la búsqueda para forzar resultados técnicos
    const query = `${brand} monitor ${monitor.Model} ${monitor.ProductCode} official model code`.trim();

    try {
        const response = await axios.post('https://google.serper.dev/search', {
            "q": query,
            "gl": "co",
            "hl": "es"
        }, {
            headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }
        });

        const results = response.data.organic;
        const officialResult = results.find(res => 
            res.link.includes('samsung.com') || res.link.includes('lenovo.com')
        );

        if (officialResult) {
            const modelFromUrl = extractModelFromUrl(officialResult.link);
            
            return {
                originalModel: monitor.Model || 'N/A',
                // Si no detectamos nada claro en la URL, devolvemos el título
                fullModelCode: modelFromUrl,
                officialUrl: officialResult.link,
                title: officialResult.title,
                snippet: officialResult.snippet // A veces el modelo está en el texto descriptivo
            };
        }
        return { error: 'No se encontró página oficial.' };
    } catch (error) {
        console.error("Error:", error.message);
    }
}

// Pruebas
const myMonitors = [
    { Manufacturer: 'SAM', Model: 'S22A33x', ProductCode: '7122' },
    { Manufacturer: 'BOE', Model: '', ProductCode: '0C82' }
];

myMonitors.forEach(async (mon) => {
    const info = await findFullModelInfo(mon);
    console.log(`\n--- [${mon.Manufacturer}] Resultado Refinado ---`);
    console.log(`Modelo Base: ${info.originalModel}`);
    console.log(`Código Detectado: ${info.fullModelCode}`);
    console.log(`URL: ${info.officialUrl}`);
});