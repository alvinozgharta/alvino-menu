import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { getAdmin, updateAdminPassword } from './db';

const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'fallback-secret-key-change-in-production-min-32-chars';
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  email: string;
  pwdUpdated: number;
}

export async function createSessionToken(email: string, pwdUpdated: Date): Promise<string> {
  const key = getSecretKey();
  return new SignJWT({
    email,
    pwdUpdated: pwdUpdated.getTime(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });

    if (!payload.email || typeof payload.pwdUpdated !== 'number') {
      return null;
    }

    return {
      email: payload.email as string,
      pwdUpdated: payload.pwdUpdated as number,
    };
  } catch {
    return null;
  }
}

export async function getAdminSession(): Promise<{ email: string } | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie?.value) {
      return null;
    }

    const payload = await verifySessionToken(sessionCookie.value);
    if (!payload) {
      return null;
    }

    const expectedEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
    if (payload.email.toLowerCase() !== expectedEmail) {
      return null;
    }

    const admin = await getAdmin();
    if (!admin) {
      return null;
    }

    // Ensure email still matches
    if (admin.email.toLowerCase() !== expectedEmail) {
      return null;
    }

    // Password invalidation check: if password was updated after session creation, reject
    if (Math.floor(admin.updatedAt.getTime() / 1000) > Math.floor(payload.pwdUpdated / 1000)) {
      return null;
    }

    return { email: admin.email };
  } catch {
    return null;
  }
}

export async function setAdminSessionCookie(token: string): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
  } catch (err) {
    // Safely handled if invoked outside request scope
    console.warn('[Auth] setAdminSessionCookie invoked outside request scope');
  }
}

export async function clearAdminSessionCookie(): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  } catch (err) {
    // Safely handled if invoked outside request scope
  }
}

export async function verifyCredentials(
  emailInput: string,
  passwordInput: string
): Promise<{ success: boolean; error?: string }> {
  const expectedEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  const cleanEmail = emailInput.trim().toLowerCase();

  // Strict check: only the exact ADMIN_EMAIL is permitted
  if (cleanEmail !== expectedEmail) {
    return { success: false, error: 'Invalid email or password.' };
  }

  const admin = await getAdmin();
  if (!admin) {
    return { success: false, error: 'Admin account not initialized.' };
  }

  const match = await bcrypt.compare(passwordInput, admin.passwordHash);
  if (!match) {
    return { success: false, error: 'Invalid email or password.' };
  }

  return { success: true };
}

export async function changeAdminPassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const admin = await getAdmin();
  if (!admin) {
    return { success: false, error: 'Admin account not found.' };
  }

  const match = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!match) {
    return { success: false, error: 'Current password is incorrect.' };
  }

  if (newPassword.length < 8) {
    return { success: false, error: 'New password must be at least 8 characters long.' };
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await updateAdminPassword(newHash);

  // Invalidate current cookie
  await clearAdminSessionCookie();

  return { success: true };
}
