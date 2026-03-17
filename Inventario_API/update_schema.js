require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

async function updateSchema() {
    const sql = neon(process.env.DATABASE_URL);
    try {
        console.log("Adding columns to inventario_equipos...");
        await sql`
            ALTER TABLE inventario_equipos 
            ADD COLUMN IF NOT EXISTS odoo_id INT,
            ADD COLUMN IF NOT EXISTS image_url TEXT,
            ADD COLUMN IF NOT EXISTS synced BOOLEAN DEFAULT false;
        `;
        console.log("Columns added successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Error updating schema:", err);
        process.exit(1);
    }
}

updateSchema();
