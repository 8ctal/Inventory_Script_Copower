require('dotenv').config();
const Odoo = require('odoo-xmlrpc');

const odoo = new Odoo({
    url: process.env.ODOO_URL,
    db: process.env.ODOO_DB,
    username: process.env.ODOO_USERNAME,
    password: process.env.ODOO_PASS
});

async function connect() {
    return new Promise((resolve, reject) => {
        odoo.connect((err, uid) => {
            if (err) return reject(err);
            resolve(uid);
        });
    });
}

function executeKw(model, method, params, kwargs = {}) {
    return new Promise((resolve, reject) => {
        let fparams = [];
        fparams.push(params);
        if (Object.keys(kwargs).length > 0) {
            fparams.push(kwargs);
        }

        try {
            odoo.execute_kw(model, method, fparams, function(err, value) {
                if (err) {
                    return reject(err);
                }
                return resolve(value);
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function testEmployees() {
    try {
        console.log("Conectando a Odoo...");
        await connect();
        console.log("Conectado exitosamente.");

        console.log("\n--- BUSCANDO EN hr.employee ---");
        const employees = await executeKw('hr.employee', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'work_email', 'user_id', 'user_partner_id'] });
        
        console.log(`Se encontraron ${employees.length} empleados activos.\n`);
        
        const emailBuscar = 'profesionalti';
        const found = employees.filter(e => {
            const byEmail = e.work_email && e.work_email.toLowerCase().includes(emailBuscar);
            const byName = e.name && e.name.toLowerCase().includes('profesional');
            return byEmail || byName;
        });
        
        if (found.length > 0) {
            console.log("Resultados de la búsqueda manual (coincidencia con 'profesionalti' o 'profesional'):");
            console.log(JSON.stringify(found, null, 2));
        } else {
            console.log("No se encontró ningún empleado en hr.employee con ese correo o nombre.");
            
            console.log("\nMuestra de 5 empleados (para ver qué campos arroja Odoo):");
            console.log(JSON.stringify(employees.slice(0, 5), null, 2));
        }

        console.log("\n--- BUSCANDO EN res.users ---");
        const users = await executeKw('res.users', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'login', 'partner_id'] });
        console.log(`Se encontraron ${users.length} usuarios activos.`);
        
        const foundUsers = users.filter(u => u.login && u.login.toLowerCase().includes(emailBuscar));
        if (foundUsers.length > 0) {
            console.log(`Resultados de la búsqueda manual en res.users (login con '${emailBuscar}'):`);
            console.log(JSON.stringify(foundUsers, null, 2));
        } else {
            console.log(`No se encontró ningún usuario con login '${emailBuscar}' en res.users.`);
            
            console.log("\nMuestra de 5 usuarios:");
            console.log(JSON.stringify(users.slice(0, 5), null, 2));
        }

    } catch (err) {
        console.error("Error consultando a Odoo:", err);
    }
}

testEmployees();
