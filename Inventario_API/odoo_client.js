require('dotenv').config();
const Odoo = require('odoo-xmlrpc');

const odoo = new Odoo({
    url: process.env.ODOO_URL,
    db: process.env.ODOO_DB,
    username: process.env.ODOO_USERNAME,
    password: process.env.ODOO_PASS
});

let cache = {
    users_by_login: {},
    users_by_login_local_domain: {},
    users_by_name: {},
    users_name_by_login: {},
    users_login_by_id: {},        // id -> login (para cruce con hr.employee)
    categories_by_name: {},
    partners_by_name: {},
    teams_by_name: {},
    employees_by_user_id: {},
    employees_by_email: {},
    employees_by_name: {},
    employees_by_user_login: {},  // res.users.login -> hr.employee.id (cruce directo)
    employees_list: []            // cache para búsquedas manuales (nombre/primer nombre)
};

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
        let fparams = [];
        fparams.push(params);
        if (Object.keys(kwargs).length > 0) {
            fparams.push(kwargs);
        }

        try {
            odoo.execute_kw(model, method, fparams, function (err, value) {
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

async function refreshCache() {
    try {
        console.log("Refreshing Odoo Cache...");
        await connect();

        // Users
        const users = await executeKw('res.users', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'login'] });
        cache.users_by_login = {};
        cache.users_by_login_local_domain = {};
        cache.users_by_name = {};
        cache.users_name_by_login = {};
        cache.users_login_by_id = {};
        users.forEach(u => {
            if (u.login) {
                const loginLower = u.login.toLowerCase();
                cache.users_by_login[loginLower] = u.id;

                const parts = loginLower.split('@');
                const localPart = parts[0] || '';
                const domainPart = parts.length > 1 ? parts.slice(1).join('@') : '';
                if (localPart && domainPart) {
                    if (!cache.users_by_login_local_domain[localPart]) cache.users_by_login_local_domain[localPart] = {};
                    cache.users_by_login_local_domain[localPart][domainPart] = u.id;
                }
            }
            if (u.name) cache.users_by_name[normalize(u.name)] = u.id;
            if (u.login && u.name) cache.users_name_by_login[u.login.toLowerCase()] = u.name;
            if (u.id && u.login) cache.users_login_by_id[u.id] = u.login.toLowerCase();
        });

        // Categories
        const categories = await executeKw('maintenance.equipment.category', 'search_read', [[]], { fields: ['id', 'name'] });
        cache.categories_by_name = {};
        categories.forEach(c => {
            if (c.name) cache.categories_by_name[normalize(c.name)] = c.id;
        });

        // Partners (Suppliers)
        const partners = await executeKw('res.partner', 'search_read', [[]], { fields: ['id', 'name'] });
        cache.partners_by_name = {};
        partners.forEach(p => {
            if (p.name) cache.partners_by_name[normalize(p.name)] = p.id;
        });

        // Teams
        const teams = await executeKw('maintenance.team', 'search_read', [[]], { fields: ['id', 'name'] });
        cache.teams_by_name = {};
        teams.forEach(t => {
            if (t.name) cache.teams_by_name[normalize(t.name)] = t.id;
        });

        // Employees
        const employees = await executeKw('hr.employee', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'work_email', 'user_id'] });
        cache.employees_list = employees;
        cache.employees_by_user_id = {};
        cache.employees_by_email = {};
        cache.employees_by_name = {};
        cache.employees_by_user_login = {};
        employees.forEach(e => {
            if (e.work_email) cache.employees_by_email[e.work_email.toLowerCase()] = e.id;
            if (e.user_id && e.user_id[0]) {
                cache.employees_by_user_id[e.user_id[0]] = e.id;
                // Cross-reference: store login -> employee_id using res.users data
                const userLogin = cache.users_login_by_id[e.user_id[0]];
                if (userLogin) cache.employees_by_user_login[userLogin] = e.id;
            }
            // Cache by normalized name as final fallback
            if (e.name) cache.employees_by_name[normalize(e.name)] = e.id;
        });
        console.log(`[Cache] employees_by_user_login entries: ${Object.keys(cache.employees_by_user_login).length}`);

        console.log("Odoo cache refreshed successfully.");
    } catch (error) {
        console.error("Error refreshing Odoo cache:", error);
    }
}

async function searchEmployeesByFirstName(firstName) {
    const trimmed = firstName ? firstName.toString().trim() : '';
    if (!trimmed) return [];

    // Si el cache no está listo aún, lo refrescamos una vez.
    if (!cache.employees_list || cache.employees_list.length === 0) {
        await refreshCache();
    }

    const normalizedRequested = normalize(trimmed);
    const requestedFirstToken = normalizedRequested.split(' ')[0];
    if (!requestedFirstToken) return [];

    const matches = (cache.employees_list || [])
        .filter(e => {
            if (!e || !e.name) return false;
            const normalizedEmployeeName = normalize(e.name);
            const employeeFirstToken = normalizedEmployeeName.split(' ')[0] || '';
            return employeeFirstToken === requestedFirstToken || normalizedEmployeeName.startsWith(requestedFirstToken);
        })
        .map(e => ({
            id: e.id,
            name: e.name,
            work_email: e.work_email || null
        }))
        .slice(0, 30);

    return matches;
}

function resolveUserId(possibleNameOrEmail) {
    if (!possibleNameOrEmail) return null;
    const trimmed = possibleNameOrEmail.toString().trim();
    if (!trimmed) return null;

    const keyEmail = trimmed.toLowerCase();
    if (cache.users_by_login[keyEmail]) return cache.users_by_login[keyEmail];

    const keyName = normalize(trimmed);
    return cache.users_by_name[keyName] || null;
}

function resolveCategoryId(categoryName) {
    if (!categoryName) return null;
    return cache.categories_by_name[normalize(categoryName)] || null;
}

function resolvePartnerId(partnerName) {
    if (!partnerName) return null;
    return cache.partners_by_name[normalize(partnerName)] || null;
}

function resolveTeamId(teamName) {
    if (!teamName) return null;
    return cache.teams_by_name[normalize(teamName)] || null;
}

function resolveEmployeeId(email) {
    const debugEnabled = process.env.ODOO_CLIENT_DEBUG === '1' || process.env.ODOO_CLIENT_DEBUG === 'true';
    const debugLog = (...args) => {
        if (debugEnabled) console.log('[DEBUG Odoo Cache]', ...args);
    };

    debugLog(`Resolving employee ID for: ${email}`);
    if (!email) {
        debugLog('No email provided to resolveEmployeeId.');
        return null;
    }
    const trimmed = email.toString().trim();
    if (!trimmed) {
        debugLog('Empty email after trim in resolveEmployeeId.');
        return null;
    }
    const keyEmail = trimmed.toLowerCase();
    debugLog('keyEmail:', keyEmail);

    const parts = keyEmail.split('@');
    const localPart = parts[0] || '';
    const domainPart = parts.length > 1 ? parts.slice(1).join('@') : '';
    debugLog('split login local/domain:', { localPart, domainPart });

    // Paso 1: match directo por res.users.login y luego derivar hr.employee desde el user_id precargado
    if (cache.users_by_login[keyEmail]) {
        const userId = cache.users_by_login[keyEmail];
        debugLog('MATCH via res.users.login -> userId:', userId);
        if (cache.employees_by_user_id[userId]) {
            const employeeId = cache.employees_by_user_id[userId];
            debugLog('MATCH via userId -> hr.employee.user_id (precargado) -> employeeId:', employeeId);
            return cache.employees_by_user_id[userId];
        }
        debugLog('Found users_by_login but no employee for that userId in cache:', userId);
    }

    // Paso 2: match por split local@domain (misma lógica, con keys preindexadas)
    if (localPart && domainPart &&
        cache.users_by_login_local_domain[localPart] &&
        cache.users_by_login_local_domain[localPart][domainPart]
    ) {
        const userId = cache.users_by_login_local_domain[localPart][domainPart];
        debugLog('MATCH via res.users.login local@domain -> userId:', userId);
        if (cache.employees_by_user_id[userId]) {
            const employeeId = cache.employees_by_user_id[userId];
            debugLog('MATCH via local@domain userId -> employeeId:', employeeId);
            return cache.employees_by_user_id[userId];
        }
        debugLog('Found local@domain -> userId but no employee for that userId in cache:', userId);
    } else {
        debugLog('No match via local@domain preindex.');
    }

    // Paso 3 (fallback): work_email directo en hr.employee
    if (cache.employees_by_email[keyEmail]) {
        const employeeId = cache.employees_by_email[keyEmail];
        debugLog('MATCH via hr.employee.work_email -> employeeId:', employeeId);
        return cache.employees_by_email[keyEmail];
    }
    debugLog('No match by login/local@domain; fallback by work_email did not match.');

    // Paso 4 (fallback): nombre del usuario en res.users contra nombre en hr.employee
    const userName = cache.users_name_by_login[keyEmail];
    if (userName) {
        const normalizedName = normalize(userName);
        debugLog(`Fallback by users_name_by_login: userName='${userName}' normalized='${normalizedName}'`);
        if (cache.employees_by_name[normalizedName]) {
            const employeeId = cache.employees_by_name[normalizedName];
            debugLog('MATCH via normalized user name -> employeeId:', employeeId);
            return cache.employees_by_name[normalizedName];
        }
        debugLog(`No employee match for normalizedName '${normalizedName}'.`);
    } else {
        debugLog(`No res.users entry for login '${keyEmail}'.`);
    }

    debugLog(`No se pudo resolver employee_id para: ${email}`);
    return null;
}

async function createEquipment(data) {
    await connect();
    const id = await executeKw('maintenance.equipment', 'create', [data]);
    return id;
}

async function updateEquipment(id, data) {
    await connect();
    const result = await executeKw('maintenance.equipment', 'write', [[id], data]);
    return result;
}

module.exports = {
    connect,
    executeKw,
    refreshCache,
    resolveUserId,
    resolveCategoryId,
    resolvePartnerId,
    resolveTeamId,
    resolveEmployeeId,
    searchEmployeesByFirstName,
    createEquipment,
    updateEquipment
};
