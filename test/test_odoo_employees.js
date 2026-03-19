const path = require('path');
const fs = require('fs');
require(path.join(__dirname, '..', 'Inventario_API', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', 'Inventario_API', '.env') });
const Odoo = require(path.join(__dirname, '..', 'Inventario_API', 'node_modules', 'odoo-xmlrpc'));

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
    try {
        const OUTPUT_PATH = path.join(__dirname, 'outputs', 'test_output_latest.json');

        console.log("Conectando a Odoo...");
        await connect();
        console.log("Conectado exitosamente.\n");

        function resolveEmployeeIdForEmail(emailKey, ctx) {
            const keyEmail = emailKey.toLowerCase();
            const parts = keyEmail.split('@');
            const localPart = parts[0] || '';
            const domainPart = parts.length > 1 ? parts.slice(1).join('@') : '';

            // Paso 1: match directo por res.users.login
            if (ctx.users_by_login[keyEmail]) {
                const userId = ctx.users_by_login[keyEmail];
                if (ctx.employees_by_user_id[userId]) {
                    return { employeeId: ctx.employees_by_user_id[userId], via: 'res.users.login->hr.employee.user_id' };
                }
                return { employeeId: null, via: 'res.users.login->missing hr.employee.user_id' };
            }

            // Paso 2: match por local@domain
            if (localPart && domainPart &&
                ctx.users_by_login_local_domain[localPart] &&
                ctx.users_by_login_local_domain[localPart][domainPart]
            ) {
                const userId = ctx.users_by_login_local_domain[localPart][domainPart];
                if (ctx.employees_by_user_id[userId]) {
                    return { employeeId: ctx.employees_by_user_id[userId], via: 'res.users.login local@domain->hr.employee.user_id' };
                }
                return { employeeId: null, via: 'res.users.login local@domain->missing hr.employee.user_id' };
            }

            // Paso 3: match directo por hr.employee.work_email
            if (ctx.employees_by_email[keyEmail]) {
                return { employeeId: ctx.employees_by_email[keyEmail], via: 'hr.employee.work_email' };
            }

            // Paso 4: fallback por nombre (cuando el email existe en res.users)
            const userName = ctx.users_name_by_login[keyEmail];
            if (userName) {
                const normalizedName = normalize(userName);
                if (ctx.employees_by_name[normalizedName]) {
                    return { employeeId: ctx.employees_by_name[normalizedName], via: 'res.users.login->name fallback' };
                }
            }

            return { employeeId: null, via: 'not_found' };
        }

        // Load users
        const users = await executeKw('res.users', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'login'] });
        const users_by_login = {};
        const users_name_by_login = {};
        const users_by_login_local_domain = {};
        users.forEach(u => {
            if (u.login) {
                const loginLower = u.login.toLowerCase();
                users_by_login[loginLower] = u.id;
                users_name_by_login[loginLower] = u.name;

                const parts = loginLower.split('@');
                const localPart = parts[0] || '';
                const domainPart = parts.length > 1 ? parts.slice(1).join('@') : '';
                if (localPart && domainPart) {
                    if (!users_by_login_local_domain[localPart]) users_by_login_local_domain[localPart] = {};
                    users_by_login_local_domain[localPart][domainPart] = u.id;
                }
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

        const ctx = {
            users_by_login,
            users_name_by_login,
            users_by_login_local_domain,
            employees_by_email,
            employees_by_user_id,
            employees_by_name
        };

        const uniqueHrEmails = [...new Set(employees.filter(e => e.work_email).map(e => e.work_email.toLowerCase()))];
        const hrEmailsNotInResUsers = uniqueHrEmails.filter(email => !users_by_login[email]);

        const loginOnlyCandidates = Object.entries(users_by_login)
            .map(([email, userId]) => {
                const employeeId = employees_by_user_id[userId];
                if (!employeeId) return null;
                const emp = employees.find(e => e.id === employeeId);
                const hasWorkEmail = Boolean(emp && emp.work_email);
                return { email, userId, employeeId, hasWorkEmail };
            })
            .filter(Boolean)
            .filter(x => x.hasWorkEmail === false);

        const testEmails = [];
        // Empleados que NO están en res.users pero SI tienen work_email (caso que te interesa)
        testEmails.push(...hrEmailsNotInResUsers.slice(0, 8));
        // Empleados que SI están en res.users pero con work_email faltante (para comprobar login->user_id)
        testEmails.push(...loginOnlyCandidates.slice(0, 3).map(x => x.email));

        const dedupedTestEmails = [...new Set(testEmails)];

        const results = {
            generatedAt: new Date().toISOString(),
            counts: {
                resUsersActive: users.length,
                hrEmployeesActive: employees.length,
                hrEmployeesWithWorkEmail: empWithEmail.length,
                hrEmployeesWithUserId: empWithUserId.length,
                hrWorkEmailNotInResUsers: hrEmailsNotInResUsers.length
            },
            testEmails: dedupedTestEmails.map(email => {
                const resUsersHasLogin = Boolean(users_by_login[email]);
                const hrHasWorkEmail = Boolean(employees_by_email[email]);

                const resolved = resolveEmployeeIdForEmail(email, ctx);
                const matchedEmployee = resolved.employeeId
                    ? employees.find(e => e.id === resolved.employeeId) || null
                    : null;

                return {
                    email,
                    resUsersHasLogin,
                    hrHasWorkEmail,
                    resolvedEmployeeId: resolved.employeeId,
                    resolvedVia: resolved.via,
                    matchedEmployee: matchedEmployee
                        ? { id: matchedEmployee.id, name: matchedEmployee.name, work_email: matchedEmployee.work_email || null }
                        : null
                };
            })
        };

        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf8');
        console.log(`\nOK: resultados escritos en: ${OUTPUT_PATH}`);

        const resolvedCount = results.testEmails.filter(t => t.resolvedEmployeeId).length;
        console.log(`Resoluciones exitosas: ${resolvedCount}/${results.testEmails.length}\n`);

        // Muestra los casos fallidos al final (más útil que spamear todo)
        const failed = results.testEmails.filter(t => !t.resolvedEmployeeId).slice(0, 10);
        if (failed.length > 0) {
            console.log('Primeros casos no resueltos:');
            failed.forEach(f => console.log(`  ${f.email} -> via=${f.resolvedVia} (resUsersHasLogin=${f.resUsersHasLogin}, hrHasWorkEmail=${f.hrHasWorkEmail})`));
        }

    } catch (err) {
        console.error("Error consultando a Odoo:", err);
    }
}

testEmployees();
