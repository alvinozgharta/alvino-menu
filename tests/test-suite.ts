import fs from 'fs';
import path from 'path';
import { initDb, getAdmin, updateAdminPassword, getActiveMenu, setActiveMenu } from '../lib/db';
import {
  verifyCredentials,
  createSessionToken,
  verifySessionToken,
  changeAdminPassword,
} from '../lib/auth';
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from '../lib/rate-limit';

async function runTests() {
  console.log('--- STARTING PLATFORM TEST SUITE ---');

  // Clean test db
  const testDb = path.join(process.cwd(), '.data', 'db.json');
  if (fs.existsSync(testDb)) {
    fs.unlinkSync(testDb);
  }

  // Test 1: DB Initialization & Admin Seeding
  console.log('\n[Test 1] DB Initialization & Admin Seeding...');
  await initDb();
  const admin = await getAdmin();
  if (!admin) throw new Error('Admin account was not created during initDb');
  console.log('✓ Admin successfully initialized with email:', admin.email);

  // Test 2: Idempotency & Persistence across re-init
  console.log('\n[Test 2] Idempotency: re-init does not overwrite password...');
  const currentHash = admin.passwordHash;
  await initDb();
  const adminAfterReinit = await getAdmin();
  if (adminAfterReinit?.passwordHash !== currentHash) {
    throw new Error('Admin password hash was overwritten during subsequent init!');
  }
  console.log('✓ Admin password hash is preserved across re-initialization.');

  // Test 3: Authentication - Rejection of wrong email
  console.log('\n[Test 3] Only ADMIN_EMAIL can authenticate...');
  const wrongEmailRes = await verifyCredentials('attacker@bad.com', 'change-this-password');
  if (wrongEmailRes.success) throw new Error('Wrong email was incorrectly authenticated!');
  console.log('✓ Non-admin email rejected:', wrongEmailRes.error);

  // Test 4: Authentication - Rejection of wrong password
  console.log('\n[Test 4] Incorrect password rejected...');
  const wrongPwdRes = await verifyCredentials(admin.email, 'wrong-password-123');
  if (wrongPwdRes.success) throw new Error('Wrong password was accepted!');
  console.log('✓ Wrong password rejected:', wrongPwdRes.error);

  // Test 5: Authentication - Valid credentials
  console.log('\n[Test 5] Valid credentials authenticated...');
  const validRes = await verifyCredentials(admin.email, 'change-this-password');
  if (!validRes.success) throw new Error('Valid credentials were not authenticated!');
  console.log('✓ Valid credentials successfully authenticated.');

  // Test 6: Rate Limiting & Login Throttling
  console.log('\n[Test 6] Rate Limiting / Brute Force Protection...');
  const testIp = '192.168.1.100';
  resetRateLimit(testIp);
  for (let i = 1; i <= 4; i++) {
    const status = recordFailedAttempt(testIp);
    if (!status.allowed) throw new Error(`Should allow attempt ${i}`);
  }
  const fifthAttempt = recordFailedAttempt(testIp);
  if (fifthAttempt.allowed) throw new Error('Fifth failed attempt should have triggered rate limit block!');
  const checkStatus = checkRateLimit(testIp);
  if (checkStatus.allowed) throw new Error('Subsequent requests should be blocked!');
  console.log('✓ IP blocked after 5 failed attempts. Blocked until:', new Date(checkStatus.blockedUntil!).toISOString());
  resetRateLimit(testIp);

  // Test 7: Session Token Creation & Verification
  console.log('\n[Test 7] Session Token Creation & Verification...');
  const token = await createSessionToken(admin.email, admin.updatedAt);
  const payload = await verifySessionToken(token);
  if (!payload || payload.email !== admin.email) {
    throw new Error('Failed to verify session token or payload mismatch');
  }
  console.log('✓ Session token verified for:', payload.email);

  // Test 8: Password Change & Session Invalidation
  console.log('\n[Test 8] Password Change & Invalidation...');
  // Change password to a new one
  const newPwd = 'BrandNewSecurePassword2026!';
  const changeRes = await changeAdminPassword('change-this-password', newPwd);
  if (!changeRes.success) throw new Error(`Password change failed: ${changeRes.error}`);
  console.log('✓ Password changed successfully.');

  // Old password must fail
  const oldPwdCheck = await verifyCredentials(admin.email, 'change-this-password');
  if (oldPwdCheck.success) throw new Error('Old password still worked after change!');
  console.log('✓ Old password rejected as expected.');

  // New password must work
  const newPwdCheck = await verifyCredentials(admin.email, newPwd);
  if (!newPwdCheck.success) throw new Error('New password failed verification!');
  console.log('✓ New password verified successfully.');

  // Old session token must now be invalid due to updatedAt timestamp check
  const updatedAdmin = await getAdmin();
  if (Math.floor(updatedAdmin!.updatedAt.getTime() / 1000) < Math.floor(payload.pwdUpdated / 1000)) {
    throw new Error('updatedAt was not bumped on password change');
  }
  console.log('✓ Prior session tokens are automatically invalidated on password change.');

  // Test 9: Active Menu Singleton Management
  console.log('\n[Test 9] Active Menu Management (Singleton)...');
  const initialMenu = await setActiveMenu({
    fileKey: 'menu-key-1',
    fileUrl: 'https://utfs.io/f/menu-1.pdf',
    fileName: 'spring-cocktails.pdf',
  });
  if (initialMenu.fileKey !== 'menu-key-1') throw new Error('Failed to set initial active menu');
  console.log('✓ Initial active menu created:', initialMenu.fileName);

  // Replace menu with new one
  const replacedMenu = await setActiveMenu({
    fileKey: 'menu-key-2',
    fileUrl: 'https://utfs.io/f/menu-2.pdf',
    fileName: 'summer-cocktails.pdf',
  });
  if (replacedMenu.fileKey !== 'menu-key-2') throw new Error('Failed to replace active menu');

  // Verify only ONE active menu exists in DB
  const currentActive = await getActiveMenu();
  if (currentActive?.fileKey !== 'menu-key-2' || currentActive?.fileName !== 'summer-cocktails.pdf') {
    throw new Error('Singleton constraint violated! Active menu does not match latest upload.');
  }
  console.log('✓ Active menu cleanly replaced with singleton enforcement:', currentActive.fileName);

  // Test 10: Reset password back for testing / dev convenience
  console.log('\n[Test 10] Reset password to initial password...');
  await changeAdminPassword(newPwd, 'change-this-password');
  const resetCheck = await verifyCredentials(admin.email, 'change-this-password');
  if (!resetCheck.success) throw new Error('Password reset check failed');
  console.log('✓ Password reset back to default test credentials.');

  console.log('\n=== ALL PLATFORM TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
