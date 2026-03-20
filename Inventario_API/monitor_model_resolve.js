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

/**
 * Neon/Postgres UTF-8 text rejects NUL (0x00). WMI -> JSON from PowerShell can include embedded nulls.
 */
function sanitizePgText(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\0/g, '').trim();
}

function normalizeKeyPart(value) {
    return sanitizePgText(value).toLowerCase();
}

function buildMonitorCacheKey(manufacturer, model, productCode) {
    return [
        normalizeKeyPart(manufacturer),
        normalizeKeyPart(model),
        normalizeKeyPart(productCode)
    ].join('|');
}

function vendorToDisplayBrand(manufacturerCode) {
    const raw = sanitizePgText(manufacturerCode);
    if (!raw) return '';
    const code = raw.toUpperCase().slice(0, 3);
    return VENDOR_MAP[code] || raw;
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
    const manufacturer = sanitizePgText(input.manufacturer);
    if (!manufacturer) {
        throw new Error('manufacturer is required');
    }

    const modelHw = sanitizePgText(input.model != null ? input.model : '');
    const productCode = sanitizePgText(input.productCode != null ? input.productCode : '');

    const cacheKey = buildMonitorCacheKey(manufacturer, modelHw, productCode);
    let cached = null;
    let cacheLookupError = null;
    try {
        cached = await lookupCache(sql, cacheKey);
    } catch (err) {
        cacheLookupError = err && err.message ? err.message : String(err);
        console.error('[monitor_resolve] DB cache lookup failed:', cacheLookupError);
    }
    const brandDisplay = vendorToDisplayBrand(manufacturer);

    if (cached) {
        return {
            from_cache: true,
            cache_key: cacheKey,
            brand_display: brandDisplay,
            manufacturer_hw: sanitizePgText(cached.manufacturer_hw) || null,
            model_hw: sanitizePgText(cached.model_hw) || null,
            product_code: sanitizePgText(cached.product_code) || null,
            commercial_model: sanitizePgText(cached.commercial_model) || null,
            reference_code: sanitizePgText(cached.reference_code) || null,
            official_url: sanitizePgText(cached.official_url) || null,
            serper_title: sanitizePgText(cached.serper_title) || null
        };
    }

    const serp = await searchMonitorSpecsViaSerper(brandDisplay, modelHw, productCode);

    let cacheUpsertError = null;
    try {
        await upsertCache(sql, {
            cache_key: cacheKey,
            manufacturer_hw: manufacturer,
            model_hw: modelHw || null,
            product_code: productCode || null,
            commercial_model: sanitizePgText(serp.commercial_model) || null,
            reference_code: sanitizePgText(serp.reference_code) || null,
            official_url: sanitizePgText(serp.official_url) || null,
            serper_title: sanitizePgText(serp.serper_title) || null
        });
    } catch (err) {
        cacheUpsertError = err && err.message ? err.message : String(err);
        console.error('[monitor_resolve] DB cache upsert failed:', cacheUpsertError);
    }

    return {
        from_cache: false,
        cache_key: cacheKey,
        brand_display: brandDisplay,
        manufacturer_hw: manufacturer,
        model_hw: modelHw || null,
        product_code: productCode || null,
        commercial_model: sanitizePgText(serp.commercial_model) || null,
        reference_code: sanitizePgText(serp.reference_code) || null,
        official_url: sanitizePgText(serp.official_url) || null,
        serper_title: sanitizePgText(serp.serper_title) || null,
        serper_snippet: sanitizePgText(serp.serper_snippet) || null,
        cache_db_lookup_error: cacheLookupError,
        cache_db_upsert_error: cacheUpsertError
    };
}

module.exports = {
    buildMonitorCacheKey,
    vendorToDisplayBrand,
    sanitizePgText,
    resolveMonitorCommercialModel
};
