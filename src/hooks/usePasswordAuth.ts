"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPasswordAuthClient, type PasswordAuthUser } from "@/lib/auth-api";

export type PasswordAuthMode = "checking" | "authenticated" | "anonymous" | "disabled";

export function usePasswordAuth() {
  const client = useMemo(() => createPasswordAuthClient(), []);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<PasswordAuthMode>("checking");
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [user, setUser] = useState<PasswordAuthUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const applyAuthState = useCallback((result: { enabled?: boolean; authMode?: string; authenticated: boolean; user: PasswordAuthUser | null; registrationEnabled?: boolean }) => {
    const nextEnabled = result.enabled ?? (result.authMode === "password");
    setRegistrationEnabled(result.registrationEnabled === true);
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
  }, []);

  const refresh = useCallback(async () => {
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
  }, [applyAuthState, client]);

  useEffect(() => {
    let active = true;
    void client.me().then((result) => {
      if (active) applyAuthState(result);
    }).catch(() => {
      if (!active) return;
      setEnabled(true);
      setUser(null);
      setMode("anonymous");
      setErrorMessage(null);
    });
    return () => {
      active = false;
    };
  }, [applyAuthState, client]);

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
    registrationEnabled,
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
