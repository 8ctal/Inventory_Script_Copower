-- 1. Tabla: Empleados
-- Ahora el correo es la Primary Key, lo que garantiza que no haya duplicados por email.
CREATE TABLE IF NOT EXISTS empleados (
    correo_empresarial VARCHAR(255) PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    numero_empresarial VARCHAR(50),
    area VARCHAR(100),
    cargo VARCHAR(100),
    fecha_creacion TIMESTAMP DEFAULT now(),
    ultima_actualizacion TIMESTAMP DEFAULT now()
);

-- 2. Tabla: Inventario de Equipos
CREATE TABLE IF NOT EXISTS inventario_equipos (
    id SERIAL PRIMARY KEY,
    hostname VARCHAR(100),
    usuario VARCHAR(100),
    fabricante VARCHAR(100),
    modelo VARCHAR(100),
    serial VARCHAR(100) UNIQUE NOT NULL,
    sistema_op VARCHAR(150),
    ram_gb NUMERIC(5,2),
    disco_total_gb NUMERIC(10,2),
    disco_libre_gb NUMERIC(10,2),
    ip_local VARCHAR(20),
    ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    procesador VARCHAR(200),
    dominio VARCHAR(100),
    usuarios_locales TEXT,
    sistema_version VARCHAR(50),
    garantia_inicio DATE NULL,
    garantia_fin DATE NULL,
    correo_empleado VARCHAR(255) NULL,
    CONSTRAINT fk_inventario_correo_empleado 
        FOREIGN KEY (correo_empleado) 
        REFERENCES empleados(correo_empresarial) 
        ON DELETE SET NULL -- Si el empleado se borra, el equipo queda "libre"
);

-- 3. Tabla: Inventario de Software
CREATE TABLE IF NOT EXISTS inventario_software (
    id SERIAL PRIMARY KEY,
    serial_equipo VARCHAR(100) UNIQUE NOT NULL,
    programas_instalados TEXT,
    cuentas_correo TEXT,
    estado_licencia VARCHAR(100),
    ultima_actualizacion TIMESTAMP DEFAULT ((now() AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota'),
    CONSTRAINT inventario_software_serial_equipo_fkey 
        FOREIGN KEY (serial_equipo) 
        REFERENCES inventario_equipos(serial) 
        ON DELETE CASCADE
);

-- 4. Tabla: Trazabilidad de Equipos
CREATE TABLE IF NOT EXISTS trazabilidad_equipos (
    id SERIAL PRIMARY KEY,
    serial_equipo VARCHAR(100) NOT NULL,
    accion VARCHAR(100) NOT NULL,
    usuario_anterior VARCHAR(255),
    usuario_nuevo VARCHAR(255),
    fecha TIMESTAMP DEFAULT now()
);

-- 5. Índices adicionales para rendimiento
CREATE INDEX IF NOT EXISTS idx_inventario_correo_empleado ON inventario_equipos(correo_empleado);
CREATE INDEX IF NOT EXISTS idx_trazabilidad_serial ON trazabilidad_equipos(serial_equipo);
CREATE INDEX IF NOT EXISTS unique_serial_software ON inventario_software(serial_equipo);