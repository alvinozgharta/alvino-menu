import { Suspense } from 'react';
import { connection } from 'next/server';
import { getAdminSession } from '@/lib/auth';
import { getActiveMenu } from '@/lib/db';
import AdminLoginForm from './LoginForm';
import AdminDashboard from './Dashboard';

async function AdminContent() {
  await connection();
  const session = await getAdminSession();

  if (!session) {
    return <AdminLoginForm />;
  }

  const activeMenu = await getActiveMenu();

  return <AdminDashboard initialMenu={activeMenu} adminEmail={session.email} />;
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950">
          <div className="w-8 h-8 rounded-full border-2 border-zinc-700 border-t-zinc-200 animate-spin" />
        </div>
      }
    >
      <AdminContent />
    </Suspense>
  );
}
