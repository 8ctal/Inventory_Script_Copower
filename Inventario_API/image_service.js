require('dotenv').config();
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

function debugLog(...args) {
    const enabled = process.env.IMAGE_SERVICE_DEBUG === '1' || process.env.IMAGE_SERVICE_DEBUG === 'true';
    if (enabled) console.log('[image_service]', ...args);
}

async function findImageOnSerper(query) {
    try {
        debugLog('Serper query:', query);
        let data = JSON.stringify({ "q": query });
        let config = {
            method: 'post',
            url: 'https://google.serper.dev/images',
            headers: { 
                'X-API-KEY': process.env.SERPER_API_KEY, 
                'Content-Type': 'application/json'
            },
            data: data
        };

        const response = await axios.request(config);
        if (response.data && response.data.images && response.data.images.length > 0) {
            // Retorna la URL de la primera imagen encontrada
            const imageUrl = response.data.images[0].imageUrl;
            debugLog('Serper result imageUrl found:', Boolean(imageUrl));
            return imageUrl;
        }
        return null;
    } catch (error) {
        console.error("Error fetching from Serper:", error.message);
        return null;
    }
}

function getPublicIdFromModelName(modelName) {
    if (!modelName) return null;
    return modelName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

function getDeviceTypeConfig(deviceType) {
    const type = (deviceType ? deviceType.toString().trim().toLowerCase() : 'laptop');

    // Folder/prefix en Cloudinary (tal como pediste)
    if (type === 'monitor' || type === 'monitores') {
        return { folder: 'inventario_equipos/monitores', querySuffix: 'monitor' };
    }

    if (type === 'celular' || type === 'celulares' || type === 'phone' || type === 'phones') {
        return { folder: 'inventario_equipos/celulares', querySuffix: 'celular' };
    }

    // Default: laptop/computadoras
    return { folder: 'inventario_equipos/maquinas', querySuffix: 'laptop' };
}

async function findImageOnCloudinary(modelo, deviceType) {
    const publicId = getPublicIdFromModelName(modelo);
    if (!publicId) return null;

    const { folder } = getDeviceTypeConfig(deviceType);
    const devicePublicId = `${folder}/${publicId}`;
    try {
        debugLog('Cloudinary lookup:', { modelo, publicId, devicePublicId });
        const resource = await cloudinary.api.resource(devicePublicId, { resource_type: 'image' });
        const secureUrl = resource.secure_url || null;
        debugLog('Cloudinary lookup result:', Boolean(secureUrl));
        return secureUrl;
    } catch (error) {
        // Si no existe, Cloudinary típicamente responde 404; cualquier error => no encontrado para permitir fallback a Serper.
        debugLog('Cloudinary lookup not found (or error):', error && error.message ? error.message : error);
        return null;
    }
}

async function uploadToCloudinary(imageUrl, modelName, deviceType) {
    try {
        const { folder } = getDeviceTypeConfig(deviceType);
        const publicId = modelName ? getPublicIdFromModelName(modelName) : undefined;
        const result = await cloudinary.uploader.upload(imageUrl, {
            folder,
            public_id: publicId
        });
        return result.secure_url;
    } catch (error) {
        console.error("Error uploading to Cloudinary:", error.message);
        return null;
    }
}

async function getBase64FromUrl(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data, 'binary').toString('base64');
    } catch (error) {
        console.error("Error getting base64 from image:", error.message);
        return null;
    }
}

async function processDeviceImage(marca, modelo, deviceType) {
    if (!modelo) return null;

    const { querySuffix } = getDeviceTypeConfig(deviceType);

    // 1) Cache persistente: si ya existe en Cloudinary, no consultamos Serper.
    debugLog('processDeviceImage start:', { marca, modelo, deviceType, querySuffix });
    const cloudinaryUrl = await findImageOnCloudinary(modelo, deviceType);
    if (cloudinaryUrl) {
        debugLog('Using Cloudinary cached url');
        return cloudinaryUrl;
    }

    // 2) Si no existe, buscamos en Serper.
    const query = `${marca} ${modelo} ${querySuffix}`;
    const serperUrl = await findImageOnSerper(query);
    if (!serperUrl) return null;

    // 3) Subimos a Cloudinary y devolvemos URL.
    debugLog('Uploading to Cloudinary from Serper...');
    const uploadedUrl = await uploadToCloudinary(serperUrl, modelo, deviceType);
    debugLog('UploadedUrl exists:', Boolean(uploadedUrl));
    return uploadedUrl;
}

module.exports = {
    findImageOnSerper,
    findImageOnCloudinary,
    getPublicIdFromModelName,
    uploadToCloudinary,
    getBase64FromUrl,
    processDeviceImage
};
