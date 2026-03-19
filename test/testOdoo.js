const path = require('path');
const fs = require('fs');
require(path.join(__dirname, '..', 'Inventario_API', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', 'Inventario_API', '.env') });
const odooClient = require('../Inventario_API/odoo_client'); // ajusta la ruta

async function runTests() {
    try {
        console.log('--- TEST: Conexión ---');
        const uid = await odooClient.connect();
        console.log('Conectado con UID:', uid);

        console.log('\n--- TEST: Refresh Cache ---');
        await odooClient.refreshCache();

        console.log('\n--- TEST: resolveUserId ---');
        const userId = odooClient.resolveUserId('alejandropabon846@gmail.com');
        console.log('User ID:', userId);

        console.log('\n--- TEST: resolveEmployeeId ---');
        const employeeId = odooClient.resolveEmployeeId('alejandropabon846@gmail.com');
        console.log('Employee ID:', employeeId);

        console.log('\n--- TEST: resolveCategoryId ---');
        const categoryId = odooClient.resolveCategoryId('EQUIPO-DE-COMPUTO');
        console.log('Category ID:', categoryId);

        console.log('\n--- TEST: resolvePartnerId ---');
        const partnerId = odooClient.resolvePartnerId('Lenovo');
        console.log('Partner ID:', partnerId);

        console.log('\n--- TEST: resolveTeamId ---');
        const teamId = odooClient.resolveTeamId('TECNOLOGIA');
        console.log('Team ID:', teamId);

    } catch (err) {
        console.error('Error en tests:', err);
    }
}

runTests();