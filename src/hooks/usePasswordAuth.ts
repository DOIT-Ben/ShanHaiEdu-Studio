"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPasswordAuthClient, type PasswordAuthUser } from "@/lib/auth-api";

export type PasswordAuthMode = "checking" | "authenticated" | "anonymous" | "disabled";

export function usePasswordAuth() {
  const staticAuthMode = process.env.NEXT_PUBLIC_SHANHAI_AUTH_MODE;
  const hasStaticAuthMode = typeof staticAuthMode === "string" && staticAuthMode.length > 0;
  const staticEnabled = staticAuthMode === "password";
  const client = useMemo(() => createPasswordAuthClient(), []);
  const [enabled, setEnabled] = useState(hasStaticAuthMode ? staticEnabled : true);
  const [mode, setMode] = useState<PasswordAuthMode>(hasStaticAuthMode && !staticEnabled ? "disabled" : "checking");
  const [user, setUser] = useState<PasswordAuthUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function applyAuthState(result: { enabled?: boolean; authMode?: string; authenticated: boolean; user: PasswordAuthUser | null }) {
    const runtimeEnabled = result.enabled ?? (result.authMode ? result.authMode === "password" : result.authenticated || Boolean(result.user));
    const nextEnabled = runtimeEnabled || (!result.authMode && staticEnabled);
    setEnabled(nextEnabled);
    if (!nextEnabled) {
      setUser(null);
      setMode("disabled");
      setErrorMessage(null);
      return;
    }
    setUser(result.user);
    setMode(result.authenticated ? "authenticated" : "anonymous");
    setErrorMessage(null);
  }

  const refresh = useCallback(async () => {
    if (hasStaticAuthMode && !staticEnabled) {
      setEnabled(false);
      setMode("disabled");
      setUser(null);
      return;
    }
    setMode("checking");
    try {
      const result = await client.me();
      applyAuthState(result);
    } catch {
      setEnabled(true);
      setUser(null);
      setMode("anonymous");
      setErrorMessage(null);
    }
  }, [client, hasStaticAuthMode, staticEnabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function register(input: { email: string; displayName?: string; password: string }) {
    setSubmitting(true);
    try {
      const result = await client.register(input);
      applyAuthState(result);
    } catch (error) {
      setErrorMessage(error instanceof Error && "userMessage" in error ? String(error.userMessage) : "创建账号没有成功，请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function login(input: { email: string; password: string }) {
    setSubmitting(true);
    try {
      const result = await client.login(input);
      applyAuthState(result);
    } catch (error) {
      setErrorMessage(error instanceof Error && "userMessage" in error ? String(error.userMessage) : "登录没有成功，请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    setSubmitting(true);
    try {
      await client.logout();
    } finally {
      window.localStorage.removeItem("shanhai.activeProjectId");
      setUser(null);
      setMode(enabled ? "anonymous" : "disabled");
      setSubmitting(false);
    }
  }

  return {
    enabled,
    mode,
    user,
    errorMessage,
    submitting,
    register,
    login,
    logout,
    refresh,
  };
}
