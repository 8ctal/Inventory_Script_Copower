require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

async function updateSchema() {
    const sql = neon(process.env.DATABASE_URL);
    try {
        console.log("Step 1: Adding columns to inventario_equipos...");
        await sql`
            ALTER TABLE inventario_equipos 
            ADD COLUMN IF NOT EXISTS odoo_id INT,
            ADD COLUMN IF NOT EXISTS image_url TEXT,
            ADD COLUMN IF NOT EXISTS synced BOOLEAN DEFAULT false;
        `;
        console.log("  -> OK");

        console.log("Step 2: Creating inventario_monitores table...");
        await sql`
            CREATE TABLE IF NOT EXISTS inventario_monitores (
                id                   SERIAL PRIMARY KEY,
                serial               VARCHAR(150) UNIQUE NOT NULL,
                marca                VARCHAR(100),
                modelo               VARCHAR(150),
                id_hardware          TEXT,          -- PNPDeviceID completo del monitor
                correo_empleado      VARCHAR(255) NULL,
                ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_monitor_empleado
                    FOREIGN KEY (correo_empleado)
                    REFERENCES empleados(correo_empresarial)
                    ON DELETE SET NULL
            );
        `;
        await sql`
            CREATE INDEX IF NOT EXISTS idx_monitores_correo 
            ON inventario_monitores(correo_empleado);
        `;
        await sql`
            ALTER TABLE inventario_monitores
            ADD COLUMN IF NOT EXISTS referencia_comercial TEXT;
        `;
        console.log("  -> OK");

        console.log("Step 2b: Creating monitor_model_cache (Serper lookup cache)...");
        await sql`
            CREATE TABLE IF NOT EXISTS monitor_model_cache (
                id                   SERIAL PRIMARY KEY,
                cache_key            VARCHAR(512) UNIQUE NOT NULL,
                manufacturer_hw      VARCHAR(100),
                model_hw             VARCHAR(255),
                product_code         VARCHAR(100),
                commercial_model     TEXT,
                reference_code       TEXT,
                official_url         TEXT,
                serper_title         TEXT,
                ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        console.log("  -> OK");

        console.log("Step 3: Creating inventario_celulares table...");
        await sql`
            CREATE TABLE IF NOT EXISTS inventario_celulares (
                id                   SERIAL PRIMARY KEY,
                serial               VARCHAR(150) UNIQUE NOT NULL,
                marca                VARCHAR(100),
                modelo               VARCHAR(150),
                imei                 VARCHAR(50),
                numero_linea         VARCHAR(50),
                correo_empleado      VARCHAR(255) NULL,
                ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_celular_empleado
                    FOREIGN KEY (correo_empleado)
                    REFERENCES empleados(correo_empresarial)
                    ON DELETE SET NULL
            );
        `;
        await sql`
            CREATE INDEX IF NOT EXISTS idx_celulares_correo 
            ON inventario_celulares(correo_empleado);
        `;
        console.log("  -> OK");

        console.log("\nSchema update completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Error updating schema:", err);
        process.exit(1);
    }
}

updateSchema();
