require("dotenv").config();
const express = require("express");
const { neon } = require("@neondatabase/serverless");
const axios = require("axios")
const app = express();
const sql = neon(process.env.DATABASE_URL);

app.use(express.json({ limit: '10mb' })); // Aumentamos límite para listas largas de software

const odooClient = require("./odoo_client");
const imageService = require("./image_service");

// Boot up logic to check and alter schema, then load Odoo cache
async function bootstrap() {
    try {
        console.log("Starting DB Schema check...");
        await sql`
            ALTER TABLE inventario_equipos 
            ADD COLUMN IF NOT EXISTS odoo_id INT,
            ADD COLUMN IF NOT EXISTS image_url TEXT,
            ADD COLUMN IF NOT EXISTS synced BOOLEAN DEFAULT false;
        `;
        console.log("DB Schema updated correctly.");
        await odooClient.refreshCache();
    } catch (err) {
        console.error("Error during bootstrapping:", err.message);
    }
}
bootstrap();

app.post("/api/inventario", async (req, res) => {
    try {
        const d = req.body;

        // Use machine timestamp if provided, otherwise fallback to server time
        const timestamp = d.timestamp_machine
            ? new Date(d.timestamp_machine).toISOString()
            : new Date().toISOString();

        let garantiaInicio = null;
        let garantiaFin = null;

        // Fetch warranty for Lenovo machines
        if (d.fabricante && d.fabricante.toLowerCase().includes("lenovo")) {
            try {
                const { execSync } = require('child_process');
                const psScriptPath = require('path').join(__dirname, 'search_warranty_lenovoweb.ps1');
                const psCommand = `powershell.exe -ExecutionPolicy Bypass -File "${psScriptPath}" -SerialNumber "${d.serial}"`;

                const output = execSync(psCommand, { encoding: 'utf-8' });

                if (output && output.trim()) {
                    const warrantyData = JSON.parse(output.trim());

                    garantiaInicio = warrantyData.WarrantyStart ? new Date(warrantyData.WarrantyStart).toISOString() : null;
                    garantiaFin = warrantyData.WarrantyEnd ? new Date(warrantyData.WarrantyEnd).toISOString() : null;
                    console.log(`Warranty found for ${d.serial}: ${garantiaInicio} to ${garantiaFin}`);
                } else {
                    console.log(`No warranty data returned for ${d.serial}`);
                }
            } catch (err) {
                console.error(`Failed to fetch warranty for ${d.serial}`, err.message);
            }
        }

        // Check employee traceability history before we update
        let empleadoAnteriorEmail = null;
        let empleadoAnteriorNombre = null;
        if (d.empleado_actual && d.empleado_actual.correo_empresarial) {
            const result = await sql`
                SELECT e.nombre, i.correo_empleado 
                FROM inventario_equipos i 
                LEFT JOIN empleados e ON i.correo_empleado = e.correo_empresarial
                WHERE i.serial = ${d.serial} LIMIT 1
            `;
            if (result.length > 0) {
                empleadoAnteriorEmail = result[0].correo_empleado;
                empleadoAnteriorNombre = result[0].nombre;
            }
        }

        // 1. Guardar Empleado Actual (esto debe ir primero para evitar violar la llave foránea)
        if (d.empleado_actual && d.empleado_actual.correo_empresarial) {
            const nuevoEmpleado = d.empleado_actual.nombre;
            const nuevoCorreo = d.empleado_actual.correo_empresarial;

            // Inserta o actualiza los datos del empleado
            await sql`
                INSERT INTO empleados (
                    correo_empresarial, nombre, numero_empresarial, area, cargo, ultima_actualizacion
                ) VALUES (
                    ${nuevoCorreo}, 
                    ${nuevoEmpleado || null}, 
                    ${d.empleado_actual.numero_empresarial || null}, 
                    ${d.empleado_actual.area || null}, 
                    ${d.empleado_actual.cargo || null}, 
                    ${timestamp}::timestamp
                )
                ON CONFLICT (correo_empresarial) DO UPDATE SET
                    nombre = EXCLUDED.nombre,
                    numero_empresarial = EXCLUDED.numero_empresarial,
                    area = EXCLUDED.area,
                    cargo = EXCLUDED.cargo,
                    ultima_actualizacion = EXCLUDED.ultima_actualizacion;
            `;

            // Guardar trazabilidad si el empleado cambió
            if (empleadoAnteriorEmail !== nuevoCorreo) {
                await sql`
                    INSERT INTO trazabilidad_equipos (
                        serial_equipo, accion, usuario_anterior, usuario_nuevo, fecha
                    ) VALUES (
                        ${d.serial}, 
                        ${empleadoAnteriorEmail ? 'Reasignación' : 'Asignación Inicial'}, 
                        ${empleadoAnteriorNombre || null}, 
                        ${nuevoEmpleado || nuevoCorreo}, 
                        ${timestamp}::timestamp
                    )
                `;
            }
        }

        // 2. Guardar Hardware (ahora seguro porque el empleado ya existe)
        await sql`
            INSERT INTO inventario_equipos (
                hostname, usuario, fabricante, modelo, serial, 
                sistema_op, sistema_version, ram_gb, procesador, 
                disco_total_gb, disco_libre_gb, dominio, usuarios_locales, 
                ip_local, ultima_actualizacion, garantia_inicio, garantia_fin,
                correo_empleado
            ) VALUES (
                ${d.hostname}, ${d.usuario}, ${d.fabricante}, ${d.modelo}, ${d.serial}, 
                ${d.sistema_op}, ${d.sistema_version}, ${d.ram_gb}, ${d.procesador}, 
                ${d.disco_total_gb}, ${d.disco_libre_gb}, ${d.dominio}, ${d.usuarios_locales}, 
                ${d.ip_local}, ${timestamp}::timestamp, ${garantiaInicio ? sql`${garantiaInicio}::date` : null}, ${garantiaFin ? sql`${garantiaFin}::date` : null},
                ${d.empleado_actual ? d.empleado_actual.correo_empresarial || null : null}
            )
            ON CONFLICT (serial) DO UPDATE SET 
                hostname = EXCLUDED.hostname, usuario = EXCLUDED.usuario,
                ram_gb = EXCLUDED.ram_gb, disco_libre_gb = EXCLUDED.disco_libre_gb,
                ip_local = EXCLUDED.ip_local, usuarios_locales = EXCLUDED.usuarios_locales,
                ultima_actualizacion = EXCLUDED.ultima_actualizacion,
                garantia_inicio = EXCLUDED.garantia_inicio,
                garantia_fin = EXCLUDED.garantia_fin,
                correo_empleado = EXCLUDED.correo_empleado;
        `;

        // 3. Guardar Software y Cuentas en la tabla relacionada
        await sql`
            INSERT INTO inventario_software (
                serial_equipo, programas_instalados, cuentas_correo, estado_licencia, ultima_actualizacion
            ) VALUES (
                ${d.serial}, ${d.programas_instalados}, ${d.cuentas_correo}, ${d.estado_licencia}, 
                ${timestamp}::timestamp
            )
            ON CONFLICT (serial_equipo) DO UPDATE SET 
                programas_instalados = EXCLUDED.programas_instalados,
                cuentas_correo = EXCLUDED.cuentas_correo,
                estado_licencia = EXCLUDED.estado_licencia,
                ultima_actualizacion = EXCLUDED.ultima_actualizacion;
        `;


        // 5. Notificar a n8n para generar Excel (Disparo asíncrono)
        const n8nWebhookUrl = "https://frameskipping.app.n8n.cloud/webhook-test/recolectar-hardware";
        axios.post(n8nWebhookUrl, {
            serial: d.serial,
            tipo: d.tipo || "Entrega"
        }).catch(err => console.error("Error llamando a n8n:", err.message));

        console.log(`Inventario actualizado en BD: ${d.hostname}`);

        // Odoo Sync Logic Asynchronously
        setTimeout(async () => {
            try {
                // 1. Resolver IDs en caché de Odoo
                const emailToResolve = d.empleado_actual ? d.empleado_actual.correo_empresarial : null;
                const empleadoOdooId = odooClient.resolveUserId(emailToResolve) || null;
                const employeeId = odooClient.resolveEmployeeId(emailToResolve) || null;
                const proveedorOdooId = odooClient.resolvePartnerId(d.proveedor) || null; // suponiendo d.proveedor existe
                const categoriaOdooId = odooClient.resolveCategoryId(d.categoria) || null;

                // 2. Buscar imagen
                console.log(`Buscando imagen para ${d.fabricante} ${d.modelo}...`);
                const imageUrl = await imageService.processDeviceImage(d.fabricante, d.modelo);
                let imageBase64 = null;
                if (imageUrl) {
                    imageBase64 = await imageService.getBase64FromUrl(imageUrl);
                }

                // 3. Crear equipo en Odoo
                console.log(`Creando equipo en Odoo para serial ${d.serial}...`);
                const equipmentData = {
                    name: `${d.fabricante} ${d.modelo} - ${d.serial}`,
                    display_name: `${d.fabricante} ${d.modelo} - ${d.serial}`,
                    serial_no: d.serial,
                    model: d.modelo,
                    location: d.ip_local || '',
                    cost: d.costo || 0,
                    rental_cost: d.costo_renta || 0,
                    note: `<p>Hostname: ${d.hostname || ''}<br/>SO: ${d.sistema_op || ''} ${d.sistema_version || ''}<br/>RAM: ${d.ram_gb || ''}GB<br/>Procesador: ${d.procesador || ''}<br/>Disco: ${d.disco_total_gb || ''}GB</p>`,
                    assign_date: timestamp.split('T')[0], // YYYY-MM-DD
                    warranty_date: garantiaFin ? garantiaFin.split('T')[0] : false,
                    effective_date: timestamp.split('T')[0],
                    period: 90,
                    maintenance_duration: 1.0,
                    image_1920: imageBase64 || false,
                    active: true,
                    day_last_maintenance_done: timestamp.split('T')[0],
                    partner_id: proveedorOdooId || false,
                    category_id: categoriaOdooId || false,
                    technician_user_id: odooClient.resolveUserId('sistemas@copower.com.co') || false,
                    maintenance_team_id: odooClient.resolveTeamId('TECNOLOGIA') || false,
                    owner_user_id: empleadoOdooId || false,
                    employee_id: employeeId || false
                };

                const odooId = await odooClient.createEquipment(equipmentData);
                console.log(`Equipo creado en Odoo con ID: ${odooId}`);

                // 4. Actualizar Neon DB con estado sync
                await sql`
                    UPDATE inventario_equipos 
                    SET odoo_id = ${odooId}, image_url = ${imageUrl}, synced = true
                    WHERE serial = ${d.serial};
                `;
                console.log(`Neon DB sync actualizado para serial ${d.serial}`);

            } catch (syncErr) {
                console.error(`Error sincronizando a Odoo para ${d.serial}:`, syncErr.message);
            }
        }, 100);

        res.status(200).json({ status: "success" });
    } catch (error) {
        console.error("Error en servidor:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Nuevos Endpoints según new_impl.md

app.post("/validate", async (req, res) => {
    try {
        const { usuario, proveedor, categoria } = req.body;
        const resUser = odooClient.resolveUserId(usuario);
        const resPartner = odooClient.resolvePartnerId(proveedor);
        const resCategory = odooClient.resolveCategoryId(categoria);
        
        res.status(200).json({
            usuario: resUser ? { id: resUser, found: true } : { found: false },
            proveedor: resPartner ? { id: resPartner, found: true } : { found: false },
            categoria: resCategory ? { id: resCategory, found: true } : { found: false }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/image", async (req, res) => {
    try {
        const { marca, modelo } = req.body;
        if (!marca || !modelo) return res.status(400).json({ error: "Falta marca o modelo" });
        const imageUrl = await imageService.processDeviceImage(marca, modelo);
        if (imageUrl) {
            res.status(200).json({ url: imageUrl });
        } else {
            res.status(404).json({ error: "Imagen no encontrada" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/sync", async (req, res) => {
    res.status(200).json({ message: "Sync manual endpoint: En desarrollo." });
});

// ---- Monitores ----
app.post("/api/monitor", async (req, res) => {
    try {
        const d = req.body;
        if (!d.serial) return res.status(400).json({ error: "El campo 'serial' es requerido." });

        const timestamp = new Date().toISOString();
        const correo = d.correo_empleado || null;

        if (correo) {
            const emp = await sql`SELECT correo_empresarial FROM empleados WHERE correo_empresarial = ${correo} LIMIT 1`;
            if (emp.length === 0) return res.status(400).json({ error: `Empleado '${correo}' no encontrado.` });
        }

        await sql`
            INSERT INTO inventario_monitores (serial, marca, modelo, id_hardware, correo_empleado, ultima_actualizacion)
            VALUES (${d.serial}, ${d.marca || null}, ${d.modelo || null}, ${d.id_hardware || null}, ${correo}, ${timestamp}::timestamp)
            ON CONFLICT (serial) DO UPDATE SET
                marca                = EXCLUDED.marca,
                modelo               = EXCLUDED.modelo,
                id_hardware          = EXCLUDED.id_hardware,
                correo_empleado      = EXCLUDED.correo_empleado,
                ultima_actualizacion = EXCLUDED.ultima_actualizacion;
        `;
        console.log(`Monitor registrado: ${d.serial} -> ${correo || 'sin empleado'}`);
        res.status(200).json({ status: "success", serial: d.serial });
    } catch (error) {
        console.error("Error en /api/monitor:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// ---- Celulares ----
app.post("/api/celular", async (req, res) => {
    try {
        const d = req.body;
        if (!d.serial) return res.status(400).json({ error: "El campo 'serial' es requerido." });

        const timestamp = new Date().toISOString();
        const correo = d.correo_empleado || null;

        if (correo) {
            const emp = await sql`SELECT correo_empresarial FROM empleados WHERE correo_empresarial = ${correo} LIMIT 1`;
            if (emp.length === 0) return res.status(400).json({ error: `Empleado '${correo}' no encontrado.` });
        }

        await sql`
            INSERT INTO inventario_celulares (serial, marca, modelo, imei, numero_linea, correo_empleado, ultima_actualizacion)
            VALUES (${d.serial}, ${d.marca || null}, ${d.modelo || null}, ${d.imei || null}, ${d.numero_linea || null}, ${correo}, ${timestamp}::timestamp)
            ON CONFLICT (serial) DO UPDATE SET
                marca                = EXCLUDED.marca,
                modelo               = EXCLUDED.modelo,
                imei                 = EXCLUDED.imei,
                numero_linea         = EXCLUDED.numero_linea,
                correo_empleado      = EXCLUDED.correo_empleado,
                ultima_actualizacion = EXCLUDED.ultima_actualizacion;
        `;
        console.log(`Celular registrado: ${d.serial} -> ${correo || 'sin empleado'}`);
        res.status(200).json({ status: "success", serial: d.serial });
    } catch (error) {
        console.error("Error en /api/celular:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post("/webhook/odoo", async (req, res) => {
    // Webhook para Odoo
    try {
        const data = req.body;
        console.log("Recibida actualización desde Odoo:", data);
        // Lógica para actualizar en Neon DB...
        res.status(200).json({ status: "success" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor listo en puerto ${PORT}`);
});
