require('dotenv').config();
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

async function findImageOnSerper(query) {
    try {
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
            return response.data.images[0].imageUrl;
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

async function findImageOnCloudinary(modelo) {
    const publicId = getPublicIdFromModelName(modelo);
    if (!publicId) return null;

    // Nuevo esquema solicitado: /inventario_equipos/maquinas
    const maquinaPublicId = `inventario_equipos/maquinas/${publicId}`;
    try {
        const resource = await cloudinary.api.resource(maquinaPublicId, { resource_type: 'image' });
        return resource.secure_url || null;
    } catch (error) {
        // Si no existe, Cloudinary típicamente responde 404; cualquier error => no encontrado para permitir fallback a Serper.
        return null;
    }
}

async function uploadToCloudinary(imageUrl, modelName) {
    try {
        const publicId = modelName ? getPublicIdFromModelName(modelName) : undefined;
        const result = await cloudinary.uploader.upload(imageUrl, {
            folder: 'inventario_equipos/maquinas',
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

async function processDeviceImage(marca, modelo) {
    if (!modelo) return null;

    // 1) Cache persistente: si ya existe en Cloudinary, no consultamos Serper.
    const cloudinaryUrl = await findImageOnCloudinary(modelo);
    if (cloudinaryUrl) return cloudinaryUrl;

    // 2) Si no existe, buscamos en Serper.
    const query = `${marca} ${modelo} laptop`;
    const serperUrl = await findImageOnSerper(query);
    if (!serperUrl) return null;

    // 3) Subimos a Cloudinary y devolvemos URL.
    const uploadedUrl = await uploadToCloudinary(serperUrl, modelo);
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
