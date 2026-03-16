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
        
        // 1. Guardar Hardware
        await sql`
            INSERT INTO inventario_equipos (
                hostname, usuario, fabricante, modelo, serial, 
                sistema_op, sistema_version, ram_gb, procesador, 
                disco_total_gb, disco_libre_gb, dominio, usuarios_locales, 
                ip_local, ultima_actualizacion
            ) VALUES (
                ${d.hostname}, ${d.usuario}, ${d.fabricante}, ${d.modelo}, ${d.serial}, 
                ${d.sistema_op}, ${d.sistema_version}, ${d.ram_gb}, ${d.procesador}, 
                ${d.disco_total_gb}, ${d.disco_libre_gb}, ${d.dominio}, ${d.usuarios_locales}, 
                ${d.ip_local}, ${timestamp}::timestamp
            )
            ON CONFLICT (serial) DO UPDATE SET 
                hostname = EXCLUDED.hostname, usuario = EXCLUDED.usuario,
                ram_gb = EXCLUDED.ram_gb, disco_libre_gb = EXCLUDED.disco_libre_gb,
                ip_local = EXCLUDED.ip_local, usuarios_locales = EXCLUDED.usuarios_locales,
                ultima_actualizacion = EXCLUDED.ultima_actualizacion;
        `;

        // 2. Guardar Software y Cuentas en la tabla relacionada
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

        // 3. Guardar Empleado Actual (solo el empleado que está usando la máquina)
        if (d.empleado_actual && d.empleado_actual.nombre) {
            await sql`
                INSERT INTO usuarios_locales (
                    nombre, correo_empresarial, numero_empresarial, area, cargo, maquina_asignada, ultima_actualizacion
                ) VALUES (
                    ${d.empleado_actual.nombre || null}, 
                    ${d.empleado_actual.correo_empresarial || null}, 
                    ${d.empleado_actual.numero_empresarial || null}, 
                    ${d.empleado_actual.area || null}, 
                    ${d.empleado_actual.cargo || null}, 
                    ${d.serial}, 
                    ${timestamp}::timestamp
                )
                ON CONFLICT (nombre, maquina_asignada) DO UPDATE SET
                    correo_empresarial = EXCLUDED.correo_empresarial,
                    numero_empresarial = EXCLUDED.numero_empresarial,
                    area = EXCLUDED.area,
                    cargo = EXCLUDED.cargo,
                    ultima_actualizacion = EXCLUDED.ultima_actualizacion;
            `;
        }


	// 4. Notificar a n8n para generar Excel (Disparo asíncrono)
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
