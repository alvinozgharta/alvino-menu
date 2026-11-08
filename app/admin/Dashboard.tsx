'use client';

import React, { useState, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { logoutAction, changePasswordAction } from './actions';
import type { ActiveMenu } from '@/lib/db';

interface DashboardProps {
  initialMenu: ActiveMenu | null;
  adminEmail: string;
}

export default function AdminDashboard({ initialMenu, adminEmail }: DashboardProps) {
  const router = useRouter();
  const [menu, setMenu] = useState<ActiveMenu | null>(initialMenu);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const [showPasswordChange, setShowPasswordChange] = useState<boolean>(false);
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    setUploadSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Invalid file type. Only PDF files are accepted.');
      setSelectedFile(null);
      return;
    }

    if (file.size > 32 * 1024 * 1024) {
      setUploadError('File size exceeds the 32MB limit.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = () => {
    if (!selectedFile || isUploading) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus('Preparing upload...');
    setUploadError(null);
    setUploadSuccess(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/menu/upload', true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 90);
        setUploadProgress(percent);
        setUploadStatus(`Uploading to storage (${percent}%)...`);
      }
    };

    xhr.onload = () => {
      setUploadProgress(100);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          setMenu(res.menu);
          setUploadSuccess('Active menu successfully replaced!');
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          router.refresh();
        } catch {
          setUploadSuccess('Menu updated.');
        }
      } else {
        try {
          const res = JSON.parse(xhr.responseText);
          setUploadError(res.error || 'Failed to upload PDF.');
        } catch {
          setUploadError('Failed to upload PDF. Existing menu remains active.');
        }
      }
      setIsUploading(false);
      setUploadStatus('');
    };

    xhr.onerror = () => {
      setUploadError('Network error during upload. Existing menu remains active.');
      setIsUploading(false);
      setUploadStatus('');
    };

    xhr.send(formData);
  };

  const handleLogout = () => {
    startTransition(async () => {
      await logoutAction();
      router.refresh();
    });
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    if (newPassword !== confirmPassword) {
      setPwdError('New passwords do not match.');
      return;
    }

    if (newPassword.length < 8) {
      setPwdError('New password must be at least 8 characters long.');
      return;
    }

    const formData = new FormData();
    formData.append('currentPassword', currentPassword);
    formData.append('newPassword', newPassword);
    formData.append('confirmPassword', confirmPassword);

    const res = await changePasswordAction(null, formData);
    if (!res.success) {
      setPwdError(res.error || 'Failed to change password.');
    } else {
      setPwdSuccess(res.message || 'Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        router.refresh();
      }, 1500);
    }
  };

  return (
    <div className="min-h-screen w-full bg-zinc-950 p-4 sm:p-8 text-zinc-100 font-sans">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header with Logout */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Menu Admin</h1>
            <p className="text-xs text-zinc-400">{adminEmail}</p>
          </div>
          <button
            onClick={handleLogout}
            disabled={isPending}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
          >
            {isPending ? 'Logging out...' : 'Log Out'}
          </button>
        </div>

        {/* 1. Current Menu Status */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider mb-3">
            Current Menu Status
          </h2>
          {menu ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg bg-zinc-950 p-3.5 border border-zinc-800/80">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-zinc-100 break-all">
                    {menu.fileName}
                  </div>
                  <div className="text-xs text-zinc-400">
                    Active since: {new Date(menu.uploadedAt).toLocaleString()}
                  </div>
                </div>
                <a
                  href="/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
                >
                  View Public Menu ↗
                </a>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
              No menu currently active. Upload a PDF below to publish.
            </div>
          )}
        </div>

        {/* 2. Upload New PDF */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">
              Upload New PDF Menu
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Select a new PDF to replace the active menu. The previous PDF will be safely removed
              from storage upon successful replacement.
            </p>
          </div>

          {uploadError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
              {uploadError}
            </div>
          )}

          {uploadSuccess && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400">
              {uploadSuccess}
            </div>
          )}

          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              disabled={isUploading}
              onChange={handleFileChange}
              className="block w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 file:cursor-pointer disabled:opacity-50"
            />

            {selectedFile && (
              <div className="flex items-center justify-between text-xs text-zinc-300 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                <span className="truncate max-w-xs">{selectedFile.name}</span>
                <span className="text-zinc-500">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
            )}

            {isUploading && (
              <div className="space-y-1.5">
                <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-zinc-200 h-2 transition-all duration-200 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="text-[11px] text-zinc-400 flex justify-between">
                  <span>{uploadStatus}</span>
                  <span>{uploadProgress}%</span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              className="w-full rounded-lg bg-zinc-100 py-2.5 text-xs font-semibold text-zinc-950 transition hover:bg-zinc-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUploading ? 'Uploading and Replacing...' : 'Upload & Replace Active Menu'}
            </button>
          </div>
        </div>

        {/* 3. Change Password Option */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <button
            type="button"
            onClick={() => setShowPasswordChange(!showPasswordChange)}
            className="flex w-full items-center justify-between text-sm font-semibold text-zinc-200 uppercase tracking-wider"
          >
            <span>Change Admin Password</span>
            <span className="text-xs text-zinc-400 lowercase font-normal">
              {showPasswordChange ? 'Hide ▲' : 'Show ▼'}
            </span>
          </button>

          {showPasswordChange && (
            <form onSubmit={handlePasswordSubmit} className="mt-4 space-y-3">
              {pwdError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 text-xs text-red-400">
                  {pwdError}
                </div>
              )}
              {pwdSuccess && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs text-emerald-400">
                  {pwdSuccess}
                </div>
              )}

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Current Password</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  New Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
              >
                Update Password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
