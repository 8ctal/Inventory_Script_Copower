# Configuración del Servicio Node.js

Este documento explica cómo ejecutar el servidor Node.js como servicio en Windows.

## Opción 1: PM2 (Recomendado - Más fácil)

PM2 es un gestor de procesos para Node.js que permite ejecutar aplicaciones en segundo plano.

### Instalación

1. Abre PowerShell como Administrador
2. Instala PM2 globalmente:
```powershell
npm install -g pm2
```

### Configuración

1. Navega a la carpeta API:
```powershell
cd C:\Users\Camilo Ávila\Desktop\Copower\inventory_scripts\API
```

2. Inicia el servidor con PM2:
```powershell
pm2 start server.js --name inventario-api
```

3. Guarda la configuración para que se inicie automáticamente al reiniciar:
```powershell
pm2 startup
pm2 save
```

### Comandos útiles de PM2

- Ver estado: `pm2 status`
- Ver logs: `pm2 logs inventario-api`
- Reiniciar: `pm2 restart inventario-api`
- Detener: `pm2 stop inventario-api`
- Eliminar: `pm2 delete inventario-api`
- Monitoreo: `pm2 monit`

---

## Opción 2: NSSM (Servicio Nativo de Windows)

NSSM crea un servicio nativo de Windows que se ejecuta automáticamente al iniciar el sistema.

### Instalación

1. Descarga NSSM desde: https://nssm.cc/download
2. Extrae el archivo ZIP
3. Copia `nssm.exe` (versión de 64 bits) a una carpeta accesible, por ejemplo: `C:\nssm\nssm.exe`

### Configuración

1. Abre PowerShell como Administrador

2. Instala el servicio:
```powershell
C:\nssm\nssm.exe install InventarioAPI
```

3. En la ventana que se abre, configura:
   - **Path**: Ruta completa a node.exe
     - Ejemplo: `C:\Program Files\nodejs\node.exe`
   - **Startup directory**: Ruta a la carpeta API
     - Ejemplo: `C:\Users\Camilo Ávila\Desktop\Copower\inventory_scripts\API`
   - **Arguments**: `server.js`

4. En la pestaña "Details":
   - **Display name**: `Inventario API`
   - **Description**: `Servicio de API para inventario de equipos`

5. En la pestaña "Log on":
   - Selecciona la cuenta que deseas usar (recomendado: cuenta de servicio o tu cuenta de usuario)

6. Haz clic en "Install service"

### Comandos útiles de NSSM

- Iniciar servicio: `C:\nssm\nssm.exe start InventarioAPI`
- Detener servicio: `C:\nssm\nssm.exe stop InventarioAPI`
- Reiniciar servicio: `C:\nssm\nssm.exe restart InventarioAPI`
- Eliminar servicio: `C:\nssm\nssm.exe remove InventarioAPI confirm`
- Editar configuración: `C:\nssm\nssm.exe edit InventarioAPI`
- Ver logs: Los logs se guardan en la carpeta que configures en la pestaña "I/O" de NSSM

---

## Verificación

Para verificar que el servicio está funcionando:

1. Abre un navegador o usa PowerShell:
```powershell
Invoke-WebRequest -Uri http://192.168.20.5:3000/api/inventario -Method POST -Body '{"test":"test"}' -ContentType "application/json"
```

2. O verifica que el puerto está escuchando:
```powershell
netstat -ano | findstr :3000
```

---

## Solución de Problemas

### El servicio no inicia

1. Verifica que Node.js está instalado: `node --version`
2. Verifica que el archivo `.env` existe en la carpeta API con la variable `DATABASE_URL`
3. Revisa los logs del servicio (PM2: `pm2 logs`, NSSM: carpeta de logs configurada)

### El servicio se detiene

1. Revisa los logs para ver errores
2. Verifica que la base de datos está accesible
3. Verifica que el puerto 3000 no está siendo usado por otro proceso

### Cambiar la configuración

- **PM2**: Edita el archivo de configuración o usa `pm2 delete` y vuelve a crear
- **NSSM**: Usa `C:\nssm\nssm.exe edit InventarioAPI`

