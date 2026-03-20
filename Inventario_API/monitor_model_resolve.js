/**
 * Resolve commercial monitor model / reference from hardware WMI fields.
 * Order: Neon cache -> Serper (google search) -> upsert cache.
 * Logic aligned with monitors_impl/monitor-check.js
 */

const axios = require('axios');

const VENDOR_MAP = {
    SAM: 'Samsung',
    LEN: 'Lenovo',
    DEL: 'Dell',
    GSM: 'LG',
    ACI: 'ASUS',
    HPQ: 'HP',
    HPN: 'HP',
    BOE: 'Lenovo BOE',
    AOC: 'AOC',
    PHL: 'Philips'
};

const URL_SEGMENT_BLACKLIST = [
    'SOLUTIONS', 'MONITORS', 'SUPPORT', 'PRODUCTS',
    'GLOBAL', 'INDEX', 'FLAT', 'PAGES', 'SPEC', 'PRODUCT'
];

function normalizeKeyPart(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim().toLowerCase();
}

function buildMonitorCacheKey(manufacturer, model, productCode) {
    return [
        normalizeKeyPart(manufacturer),
        normalizeKeyPart(model),
        normalizeKeyPart(productCode)
    ].join('|');
}

function vendorToDisplayBrand(manufacturerCode) {
    if (!manufacturerCode) return '';
    const code = String(manufacturerCode).trim().toUpperCase().slice(0, 3);
    return VENDOR_MAP[code] || String(manufacturerCode).trim();
}

function extractModelFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const cleanUrl = url.split('?')[0].replace(/\/$/, '');
    const segments = cleanUrl.split('/');

    for (let i = segments.length - 1; i >= 0; i -= 1) {
        const segment = segments[i].toUpperCase();
        if (
            segment.length >= 7 &&
            /[0-9]/.test(segment) &&
            /[A-Z]/.test(segment) &&
            !URL_SEGMENT_BLACKLIST.includes(segment)
        ) {
            return segment;
        }
    }
    return null;
}

function pickOfficialOrganic(organic) {
    if (!organic || !Array.isArray(organic) || organic.length === 0) return null;
    const official = organic.find((res) =>
        res.link && (
            res.link.includes('samsung.com') ||
            res.link.includes('lenovo.com') ||
            res.link.includes('dell.com') ||
            res.link.includes('hp.com') ||
            res.link.includes('lg.com') ||
            res.link.includes('asus.com')
        )
    );
    return official || organic[0];
}

async function searchMonitorSpecsViaSerper(brandDisplay, modelHw, productCode) {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
        throw new Error('SERPER_API_KEY is not configured');
    }

    const query = `${brandDisplay} monitor ${modelHw} ${productCode} official model code`.trim();

    const response = await axios.post(
        'https://google.serper.dev/search',
        { q: query, gl: 'co', hl: 'es' },
        {
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json'
            }
        }
    );

    const organic = response.data && response.data.organic ? response.data.organic : [];
    const hit = pickOfficialOrganic(organic);

    if (!hit || !hit.link) {
        return {
            commercial_model: null,
            reference_code: null,
            official_url: null,
            serper_title: null,
            serper_snippet: null
        };
    }

    const fromUrl = extractModelFromUrl(hit.link);
    const commercial_model = fromUrl || (hit.title ? hit.title.trim() : null);
    const reference_code = fromUrl || null;

    return {
        commercial_model,
        reference_code,
        official_url: hit.link,
        serper_title: hit.title || null,
        serper_snippet: hit.snippet || null
    };
}

async function lookupCache(sql, cacheKey) {
    const rows = await sql`
        SELECT cache_key, manufacturer_hw, model_hw, product_code,
               commercial_model, reference_code, official_url, serper_title
        FROM monitor_model_cache
        WHERE cache_key = ${cacheKey}
        LIMIT 1
    `;
    return rows.length > 0 ? rows[0] : null;
}

async function upsertCache(sql, row) {
    const now = new Date().toISOString();
    await sql`
        INSERT INTO monitor_model_cache (
            cache_key, manufacturer_hw, model_hw, product_code,
            commercial_model, reference_code, official_url, serper_title,
            ultima_actualizacion
        ) VALUES (
            ${row.cache_key},
            ${row.manufacturer_hw},
            ${row.model_hw},
            ${row.product_code},
            ${row.commercial_model},
            ${row.reference_code},
            ${row.official_url},
            ${row.serper_title},
            ${now}::timestamp
        )
        ON CONFLICT (cache_key) DO UPDATE SET
            commercial_model = EXCLUDED.commercial_model,
            reference_code = EXCLUDED.reference_code,
            official_url = EXCLUDED.official_url,
            serper_title = EXCLUDED.serper_title,
            ultima_actualizacion = EXCLUDED.ultima_actualizacion
    `;
}

/**
 * @param {*} sql - Neon tagged template function (same as server.js `sql`)
 * @param {{ manufacturer: string, model?: string|null, productCode?: string|null }} input
 */
async function resolveMonitorCommercialModel(sql, input) {
    const manufacturer = input.manufacturer;
    if (!manufacturer || !String(manufacturer).trim()) {
        throw new Error('manufacturer is required');
    }

    const modelHw = input.model != null ? String(input.model) : '';
    const productCode = input.productCode != null ? String(input.productCode) : '';

    const cacheKey = buildMonitorCacheKey(manufacturer, modelHw, productCode);
    const cached = await lookupCache(sql, cacheKey);
    const brandDisplay = vendorToDisplayBrand(manufacturer);

    if (cached) {
        return {
            from_cache: true,
            cache_key: cacheKey,
            brand_display: brandDisplay,
            manufacturer_hw: cached.manufacturer_hw,
            model_hw: cached.model_hw,
            product_code: cached.product_code,
            commercial_model: cached.commercial_model,
            reference_code: cached.reference_code,
            official_url: cached.official_url,
            serper_title: cached.serper_title
        };
    }

    const serp = await searchMonitorSpecsViaSerper(brandDisplay, modelHw, productCode);

    await upsertCache(sql, {
        cache_key: cacheKey,
        manufacturer_hw: String(manufacturer).trim(),
        model_hw: modelHw || null,
        product_code: productCode || null,
        commercial_model: serp.commercial_model,
        reference_code: serp.reference_code,
        official_url: serp.official_url,
        serper_title: serp.serper_title
    });

    return {
        from_cache: false,
        cache_key: cacheKey,
        brand_display: brandDisplay,
        manufacturer_hw: String(manufacturer).trim(),
        model_hw: modelHw || null,
        product_code: productCode || null,
        commercial_model: serp.commercial_model,
        reference_code: serp.reference_code,
        official_url: serp.official_url,
        serper_title: serp.serper_title,
        serper_snippet: serp.serper_snippet
    };
}

module.exports = {
    buildMonitorCacheKey,
    vendorToDisplayBrand,
    resolveMonitorCommercialModel
};
