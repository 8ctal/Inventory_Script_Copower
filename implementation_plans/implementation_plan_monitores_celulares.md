# Monitores y Celulares: Nuevas Tablas y Scripts de Recolección

Añadir soporte para inventario de **monitores** y **celulares** como dispositivos adicionales asociados a un empleado. Siguiendo el mismo patrón de `inventario_equipos`: relación N empleados → muchos dispositivos a través de `correo_empleado` (FK a `empleados`).

## Cambios Propuestos

---

### Base de Datos — [db/db_init.sql](file:///y:/db/db_init.sql)

#### [MODIFY] [db_init.sql](file:///y:/db/db_init.sql)

Agregar dos nuevas tablas al final del archivo:
- **`inventario_monitores`**: `serial` (PK), `marca`, `modelo`, `id_hardware` (del PnPDeviceID), `correo_empleado` (FK), `ultima_actualizacion`.
- **`inventario_celulares`**: `serial` (PK), `marca`, `modelo`, `imei`, `numero_linea`, `correo_empleado` (FK), `ultima_actualizacion`.

---

### API — [Inventario_API/server.js](file:///y:/Inventario_API/server.js)

#### [MODIFY] [server.js](file:///y:/Inventario_API/server.js)

Agregar dentro del [bootstrap()](file:///y:/Inventario_API/server.js#13-29) los `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS` para las dos nuevas tablas (igual que hoy para las columnas de `inventario_equipos`).

Añadir dos nuevos endpoints POST:
- **`POST /api/monitor`** — recibe datos del monitor (marca, modelo, serial, id_hardware, correo_empleado) y hace `INSERT ... ON CONFLICT (serial) DO UPDATE`.
- **`POST /api/celular`** — recibe datos del celular (marca, modelo, serial, imei, numero_linea, correo_empleado) y hace `INSERT ... ON CONFLICT (serial) DO UPDATE`.

---

### Scripts PowerShell

#### [NEW] [Inventario_Monitor.ps1](file:///y:/Inventario_script/Inventario_Monitor.ps1)

Script para inventariar monitores conectados:
1. Ejecuta `Get-CimInstance Win32_PnPEntity | Where-Object { $_.Service -eq "monitor" }` y filtra los que no contienen "Integrado/Internal/Generic".
2. Muestra la lista de monitores detectados (nombre + PNPDeviceID).
3. Intenta parsear el `serial` y `modelo` del `PNPDeviceID` (patrón `MONITOR\<MARCA><MODELO>\<SERIAL_HEX>`).
4. Permite al técnico editar/confirmar: marca, modelo, serial.
5. Pide correo del empleado asignado.
6. Envía `POST /api/monitor`.

#### [NEW] [Inventario_Celular.ps1](file:///y:/Inventario_script/Inventario_Celular.ps1)

Script completamente **manual** (no hay detección automática en Windows para celulares):
1. Muestra formulario interactivo: marca, modelo, serial, IMEI, número de línea.
2. Pide correo del empleado asignado.
3. Envía `POST /api/celular`.

---

## Verificación

### Prueba de endpoints (manual)

Después de reiniciar el servidor, ejecutar desde PowerShell en la máquina servidor:

```powershell
# Test monitor
Invoke-RestMethod -Uri "http://localhost:3000/api/monitor" -Method Post -ContentType "application/json" -Body '{"marca":"Dell","modelo":"P2419H","serial":"TEST-MON-001","id_hardware":"MONITOR\\DELA0EC\\ABC123","correo_empleado":"profesionalTI@copower.com.co"}'

# Test celular
Invoke-RestMethod -Uri "http://localhost:3000/api/celular" -Method Post -ContentType "application/json" -Body '{"marca":"Samsung","modelo":"Galaxy S23","serial":"TEST-CEL-001","imei":"123456789012345","numero_linea":"3001234567","correo_empleado":"profesionalTI@copower.com.co"}'
```

Verificar en NeonDB que los registros aparecen en `inventario_monitores` e `inventario_celulares`.

### Prueba de scripts PS (manual)

Ejecutar ambos scripts desde PowerShell y verificar que los datos llegan al servidor:
```powershell
.\Inventario_script\Inventario_Monitor.ps1
.\Inventario_script\Inventario_Celular.ps1
```
