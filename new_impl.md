PowerShell / otras fuentes
        ↓
     Neon DB
        ↓
 Node.js API (CORE)
   ├── /validate (usuarios, categorías, proveedores)
   ├── /image (busca + guarda imagen)
   ├── /sync (envía a Odoo)
        ↓
     Odoo
1. FLUJO COMPLETO (end-to-end)
     1. Llega máquina a Neon
2. Node detecta registro nuevo
3. Node valida:
   - responsable → res.users
   - categoría → maintenance.equipment.category
   - proveedor → res.partner
4. Node busca imagen (asociar con nombre de maquina a URL para proximas maquinas):
   - Serper API
   - filtra mejor resultado
   - sube a Cloudinary
5. Node crea máquina en Odoo
6. Guarda odoo_id + image_url en Neon

                ┌──────────────┐
                │ PowerShell   │
                └──────┬───────┘
                       │
                       ▼
                ┌──────────────┐
                │ Neon DB      │
                └──────┬───────┘
                       │
         ┌─────────────▼─────────────┐
         │ Node.js Backend (CORE)    │
         │                           │
         │  /validate                │
         │  /image                   │
         │  /sync                    │
         │  /webhook/odoo            │
         │                           │
         └──────┬─────────┬─────────┘
                │         │
                ▼         ▼
         Odoo API     Cloudinary
                ▲
                │
             Serper
OBJETIVO

Sincronizar:

Neon DB  ⇄  Node Backend  ⇄  Odoo (maintenance.equipment)

Con:

- validación previa (usuarios, categorías, proveedores)
- enriquecimiento (imágenes con Serper + Cloudinary)
- sincronización bidireccional (webhook)
- control de duplicados
- cache inteligente

4. ENDPOINTS
📌 /validate

Valida relaciones antes de tocar Odoo

POST /validate

📌 /image
POST /image

📌 /sync
POST /sync

📌 /webhook/odoo
POST /webhook/odoo

CACHE (MUY IMPORTANTE)
🔹 Qué cachear

| entidad     | modelo Odoo                    |
| ----------- | ------------------------------ |
| usuarios    | res.users                      |
| proveedores | res.partner                    |
| categorías  | maintenance.equipment.category |

Maneja todo por funciones que se puedan mantener y no dependan de muchas otras, también recuerda llevar buenas prácticas con las variables de entorno

NOTA IMPORTANTE: La api de Odoo se está manejando con Python, puedes buscar una forma de conectarla o si es necesario puedes migrarla a Node.js
7. SERVICIO DE IMÁGENES
marca + modelo → Serper → imageUrl → Cloudinary → guardar URL
Recuerda que la imagen en Odoo para que se muestre debe ir en formato base64

Asegúrate de agregar un campo a la base de datos ya existente en Neon para guardar la url de la imagen y el id de odoo y un campo que indique si ya está sincronizada.


Ejemplo uso API serper

const axios = require('axios');
let data = JSON.stringify({
  "q": "lenovo e590 20NC"
});

let config = {
  method: 'post',
  maxBodyLength: Infinity,
  url: 'https://google.serper.dev/images',
  headers: { 
    'X-API-KEY': '34f2ff0cc51510de8e9bb86072918656f3b68319', 
    'Content-Type': 'application/json'
  },
  data : data
};

async function makeRequest() {
  try {
    const response = await axios.request(config);
    console.log(JSON.stringify(response.data));
  }
  catch (error) {
    console.log(error);
  }
}

makeRequest();