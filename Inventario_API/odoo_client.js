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
    users_by_name: {},
    categories_by_name: {},
    partners_by_name: {},
    teams_by_name: {}
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

async function refreshCache() {
    try {
        console.log("Refreshing Odoo Cache...");
        await connect();
        
        // Users
        const users = await executeKw('res.users', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'login'] });
        cache.users_by_login = {};
        cache.users_by_name = {};
        users.forEach(u => {
            if (u.login) cache.users_by_login[u.login.toLowerCase()] = u.id;
            if (u.name) cache.users_by_name[normalize(u.name)] = u.id;
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

        console.log("Odoo cache refreshed successfully.");
    } catch (error) {
        console.error("Error refreshing Odoo cache:", error);
    }
}

function resolveUserId(possibleNameOrEmail) {
    if (!possibleNameOrEmail) return null;
    let keyEmail = possibleNameOrEmail.toLowerCase();
    if (cache.users_by_login[keyEmail]) return cache.users_by_login[keyEmail];
    let keyName = normalize(possibleNameOrEmail);
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
    createEquipment,
    updateEquipment
};
