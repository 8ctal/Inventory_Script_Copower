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
                'X-API-KEY': process.env.SERVER_API_KEY || process.env.SERPER_API_KEY, 
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

async function uploadToCloudinary(imageUrl, modelName) {
    try {
        const publicId = modelName ? modelName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() : undefined;
        const result = await cloudinary.uploader.upload(imageUrl, {
            folder: 'inventario_equipos',
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
    const query = `${marca} ${modelo} laptop`;
    const serperUrl = await findImageOnSerper(query);
    if (!serperUrl) return null;

    const cloudinaryUrl = await uploadToCloudinary(serperUrl, modelo);
    return cloudinaryUrl;
}

module.exports = {
    findImageOnSerper,
    uploadToCloudinary,
    getBase64FromUrl,
    processDeviceImage
};
