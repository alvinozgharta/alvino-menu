import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

export interface AdminUser {
  id: number;
  email: string;
  passwordHash: string;
  updatedAt: Date;
}

export interface ActiveMenu {
  id: number;
  fileKey: string;
  fileUrl: string;
  fileName: string;
  uploadedAt: Date;
}

const LOCAL_STORAGE_DIR = path.join(process.cwd(), '.data');
const LOCAL_STORAGE_PATH = path.join(LOCAL_STORAGE_DIR, 'db.json');

interface LocalDbSchema {
  admin: {
    id: number;
    email: string;
    passwordHash: string;
    updatedAt: string;
  } | null;
  activeMenu: {
    id: number;
    fileKey: string;
    fileUrl: string;
    fileName: string;
    uploadedAt: string;
  } | null;
}

function getLocalData(): LocalDbSchema {
  try {
    if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
      fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOCAL_STORAGE_PATH)) {
      const initial: LocalDbSchema = { admin: null, activeMenu: null };
      fs.writeFileSync(LOCAL_STORAGE_PATH, JSON.stringify(initial, null, 2));
      return initial;
    }
    const raw = fs.readFileSync(LOCAL_STORAGE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { admin: null, activeMenu: null };
  }
}

function saveLocalData(data: LocalDbSchema) {
  try {
    if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
      fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
    }
    fs.writeFileSync(LOCAL_STORAGE_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[DB] Failed to save local data:', err);
  }
}

let dbInitialized = false;

export async function initDb(): Promise<void> {
  if (dbInitialized) return;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || 'change-this-password';

  if (databaseUrl) {
    try {
      const sql = neon(databaseUrl);

      // Create admin table
      await sql`
        CREATE TABLE IF NOT EXISTS admin_user (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      // Create menu table
      await sql`
        CREATE TABLE IF NOT EXISTS active_menu (
          id INTEGER PRIMARY KEY,
          file_key TEXT NOT NULL,
          file_url TEXT NOT NULL,
          file_name TEXT NOT NULL,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      // Check if admin exists
      const existing = await sql`
        SELECT id, email, password_hash, updated_at FROM admin_user WHERE id = 1 LIMIT 1;
      `;

      if (existing.length === 0) {
        // First initialization: seed admin with hashed initial password
        const passwordHash = await bcrypt.hash(initialPassword, 10);
        await sql`
          INSERT INTO admin_user (id, email, password_hash, updated_at)
          VALUES (1, ${adminEmail}, ${passwordHash}, NOW())
          ON CONFLICT (id) DO NOTHING;
        `;
        console.log('[DB] Neon DB: Initialized singleton admin account for:', adminEmail);
      } else {
        // Admin already exists. Do NOT overwrite password_hash.
        // Sync email if ADMIN_EMAIL was changed in environment
        if (existing[0].email !== adminEmail) {
          await sql`
            UPDATE admin_user SET email = ${adminEmail} WHERE id = 1;
          `;
        }
      }

      dbInitialized = true;
      return;
    } catch (err) {
      console.error('[DB] Neon initialization failed, falling back to local store:', err);
    }
  }

  // Local fallback when DATABASE_URL is not provided or unavailable
  const localData = getLocalData();
  if (!localData.admin) {
    const passwordHash = await bcrypt.hash(initialPassword, 10);
    localData.admin = {
      id: 1,
      email: adminEmail,
      passwordHash,
      updatedAt: new Date().toISOString(),
    };
    saveLocalData(localData);
    console.log('[DB] Local store: Initialized singleton admin account for:', adminEmail);
  } else if (localData.admin.email !== adminEmail) {
    localData.admin.email = adminEmail;
    saveLocalData(localData);
  }

  dbInitialized = true;
}

export async function getAdmin(): Promise<AdminUser | null> {
  await initDb();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    try {
      const sql = neon(databaseUrl);
      const rows = await sql`
        SELECT id, email, password_hash, updated_at FROM admin_user WHERE id = 1 LIMIT 1;
      `;
      if (rows.length > 0) {
        return {
          id: rows[0].id,
          email: rows[0].email,
          passwordHash: rows[0].password_hash,
          updatedAt: new Date(rows[0].updated_at),
        };
      }
    } catch (err) {
      console.error('[DB] Error fetching admin from Neon, checking local fallback:', err);
    }
  }

  const local = getLocalData();
  if (!local.admin) return null;
  return {
    id: local.admin.id,
    email: local.admin.email,
    passwordHash: local.admin.passwordHash,
    updatedAt: new Date(local.admin.updatedAt),
  };
}

export async function updateAdminPassword(newPasswordHash: string): Promise<void> {
  await initDb();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const now = new Date();

  if (databaseUrl) {
    try {
      const sql = neon(databaseUrl);
      await sql`
        UPDATE admin_user
        SET password_hash = ${newPasswordHash}, updated_at = ${now.toISOString()}
        WHERE id = 1;
      `;
      return;
    } catch (err) {
      console.error('[DB] Error updating admin password in Neon:', err);
      throw err;
    }
  }

  const local = getLocalData();
  if (local.admin) {
    local.admin.passwordHash = newPasswordHash;
    local.admin.updatedAt = now.toISOString();
    saveLocalData(local);
  }
}

export async function getActiveMenu(): Promise<ActiveMenu | null> {
  await initDb();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    try {
      const sql = neon(databaseUrl);
      const rows = await sql`
        SELECT id, file_key, file_url, file_name, uploaded_at
        FROM active_menu
        WHERE id = 1
        LIMIT 1;
      `;
      if (rows.length > 0) {
        return {
          id: rows[0].id,
          fileKey: rows[0].file_key,
          fileUrl: rows[0].file_url,
          fileName: rows[0].file_name,
          uploadedAt: new Date(rows[0].uploaded_at),
        };
      }
      return null;
    } catch (err) {
      console.error('[DB] Error fetching active menu from Neon, checking local:', err);
    }
  }

  const local = getLocalData();
  if (!local.activeMenu) return null;
  return {
    id: local.activeMenu.id,
    fileKey: local.activeMenu.fileKey,
    fileUrl: local.activeMenu.fileUrl,
    fileName: local.activeMenu.fileName,
    uploadedAt: new Date(local.activeMenu.uploadedAt),
  };
}

export async function setActiveMenu(menu: {
  fileKey: string;
  fileUrl: string;
  fileName: string;
}): Promise<ActiveMenu> {
  await initDb();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const now = new Date();

  if (databaseUrl) {
    try {
      const sql = neon(databaseUrl);
      const rows = await sql`
        INSERT INTO active_menu (id, file_key, file_url, file_name, uploaded_at)
        VALUES (1, ${menu.fileKey}, ${menu.fileUrl}, ${menu.fileName}, ${now.toISOString()})
        ON CONFLICT (id) DO UPDATE SET
          file_key = EXCLUDED.file_key,
          file_url = EXCLUDED.file_url,
          file_name = EXCLUDED.file_name,
          uploaded_at = EXCLUDED.uploaded_at
        RETURNING id, file_key, file_url, file_name, uploaded_at;
      `;

      return {
        id: rows[0].id,
        fileKey: rows[0].file_key,
        fileUrl: rows[0].file_url,
        fileName: rows[0].file_name,
        uploadedAt: new Date(rows[0].uploaded_at),
      };
    } catch (err) {
      console.error('[DB] Error saving active menu to Neon:', err);
      throw err;
    }
  }

  const local = getLocalData();
  const updatedMenu: ActiveMenu = {
    id: 1,
    fileKey: menu.fileKey,
    fileUrl: menu.fileUrl,
    fileName: menu.fileName,
    uploadedAt: now,
  };
  local.activeMenu = {
    id: 1,
    fileKey: menu.fileKey,
    fileUrl: menu.fileUrl,
    fileName: menu.fileName,
    uploadedAt: now.toISOString(),
  };
  saveLocalData(local);
  return updatedMenu;
}
