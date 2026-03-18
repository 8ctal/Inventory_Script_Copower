require('dotenv').config();
const Odoo = require('odoo-xmlrpc');

const odoo = new Odoo({
    url: process.env.ODOO_URL,
    db: process.env.ODOO_DB,
    username: process.env.ODOO_USERNAME,
    password: process.env.ODOO_PASS
});

function normalize(s) {
    if (!s) return '';
    return s.toString().trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

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
        let fparams = [params];
        if (Object.keys(kwargs).length > 0) fparams.push(kwargs);
        try {
            odoo.execute_kw(model, method, fparams, (err, value) => {
                if (err) return reject(err);
                return resolve(value);
            });
        } catch (e) { reject(e); }
    });
}

async function testEmployees() {
    const EMAIL_TO_TEST = 'profesionalTI@copower.com.co';

    try {
        console.log("Conectando a Odoo...");
        await connect();
        console.log("Conectado exitosamente.\n");

        // Load users
        const users = await executeKw('res.users', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'login'] });
        const users_by_login = {};
        const users_name_by_login = {};
        users.forEach(u => {
            if (u.login) {
                users_by_login[u.login.toLowerCase()] = u.id;
                users_name_by_login[u.login.toLowerCase()] = u.name;
            }
        });
        console.log(`Total res.users activos: ${users.length}`);

        // Load employees
        const employees = await executeKw('hr.employee', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'work_email', 'user_id'] });
        const employees_by_email = {};
        const employees_by_user_id = {};
        const employees_by_name = {};
        employees.forEach(e => {
            if (e.work_email) employees_by_email[e.work_email.toLowerCase()] = e.id;
            if (e.user_id && e.user_id[0]) employees_by_user_id[e.user_id[0]] = e.id;
            if (e.name) employees_by_name[normalize(e.name)] = e.id;
        });
        const empWithEmail = employees.filter(e => e.work_email);
        const empWithUserId = employees.filter(e => e.user_id && e.user_id[0]);
        console.log(`Total hr.employee activos: ${employees.length}`);
        console.log(`  -> Con work_email: ${empWithEmail.length}`);
        console.log(`  -> Con user_id vinculado: ${empWithUserId.length}\n`);

        // Simulate 3-step resolution
        const emailKey = EMAIL_TO_TEST.toLowerCase();
        console.log(`=== Simulando resolveEmployeeId('${EMAIL_TO_TEST}') ===`);

        // Step 1
        if (employees_by_email[emailKey]) {
            console.log(`[PASO 1] EXITO por work_email -> employee_id: ${employees_by_email[emailKey]}`);
            return;
        }
        console.log(`[PASO 1] No encontrado por work_email.`);

        // Step 2
        const userId = users_by_login[emailKey];
        if (userId) {
            console.log(`[PASO 2] Usuario encontrado en res.users -> user.id: ${userId}, user.name: ${users_name_by_login[emailKey]}`);
            if (employees_by_user_id[userId]) {
                console.log(`[PASO 2] EXITO por user_id -> employee_id: ${employees_by_user_id[userId]}`);
                return;
            }
            console.log(`[PASO 2] hr.employee no tiene user_id vinculado a ${userId}.`);

            // Step 3: name fallback
            const userName = users_name_by_login[emailKey];
            const normalizedName = normalize(userName);
            console.log(`[PASO 3] Intentando por nombre: '${userName}' -> normalizado: '${normalizedName}'`);
            if (employees_by_name[normalizedName]) {
                console.log(`[PASO 3] EXITO por nombre -> employee_id: ${employees_by_name[normalizedName]}`);

                const matchedEmp = employees.find(e => normalize(e.name) === normalizedName);
                console.log(`\nEmpleado encontrado:`);
                console.log(JSON.stringify(matchedEmp, null, 2));
                return;
            }
            console.log(`[PASO 3] No hay coincidencia de nombre '${normalizedName}' en hr.employee.`);
            
            // Show some normalized names for debugging
            console.log(`\nMuestra de nombres normalizados en hr.employee (para detectar discrepancias):`);
            employees.slice(0, 10).forEach(e => console.log(`  '${e.name}' => '${normalize(e.name)}'`));
        } else {
            console.log(`[PASO 2] No existe res.users con login '${emailKey}'.`);
        }

        console.log(`\nRESULTADO FINAL: No se pudo resolver employee_id para '${EMAIL_TO_TEST}'.`);

    } catch (err) {
        console.error("Error consultando a Odoo:", err);
    }
}

testEmployees();
