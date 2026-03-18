const axios = require('axios');

async function testValidate() {
    try {
        console.log("=== Testing /validate ===");
        const response = await axios.post('http://localhost:3000/validate', {
            usuario: 'sistemas@copower.com.co',
            proveedor: 'Lenovo',
            categoria: 'EQUIPO DE COMPUTO'
        });
        console.log("Response:", response.data);
    } catch (error) {
        console.error("Error in validate:", error.message);
    }
}

async function testImage() {
    try {
        console.log("\n=== Testing /image ===");
        const response = await axios.post('http://localhost:3000/image', {
            marca: 'Lenovo',
            modelo: 'ThinkPad E590'
        });
        console.log("Response:", response.data);
    } catch (error) {
        console.error("Error in image:", error.message);
    }
}

async function runTests() {
    await testValidate();
    await testImage();
    console.log("\nTests finished.");
}

runTests();
