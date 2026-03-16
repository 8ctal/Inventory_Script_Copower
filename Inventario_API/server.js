require("dotenv").config();
const express = require("express");
const { neon } = require("@neondatabase/serverless");
const axios = require("axios")
const app = express();
const sql = neon(process.env.DATABASE_URL);

app.use(express.json({ limit: '10mb' })); // Aumentamos límite para listas largas de software

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

        console.log(`Inventario actualizado: ${d.hostname}`);
        res.status(200).json({ status: "success" });
    } catch (error) {
        console.error("Error en servidor:", error.message);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor listo en puerto ${PORT}`);
});
