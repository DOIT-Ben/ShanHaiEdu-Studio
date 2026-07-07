"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPasswordAuthClient, type PasswordAuthUser } from "@/lib/auth-api";

export type PasswordAuthMode = "checking" | "authenticated" | "anonymous" | "disabled";

export function usePasswordAuth() {
  const enabled = process.env.NEXT_PUBLIC_SHANHAI_AUTH_MODE === "password";
  const client = useMemo(() => createPasswordAuthClient(), []);
  const [mode, setMode] = useState<PasswordAuthMode>(enabled ? "checking" : "disabled");
  const [user, setUser] = useState<PasswordAuthUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setMode("disabled");
      setUser(null);
      return;
    }
    setMode("checking");
    try {
      const result = await client.me();
      setUser(result.user);
      setMode(result.authenticated ? "authenticated" : "anonymous");
      setErrorMessage(null);
    } catch {
      setUser(null);
      setMode("anonymous");
      setErrorMessage(null);
    }
  }, [client, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function register(input: { email: string; displayName?: string; password: string }) {
    setSubmitting(true);
    try {
      const result = await client.register(input);
      setUser(result.user);
      setMode(result.authenticated ? "authenticated" : "anonymous");
      setErrorMessage(null);
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
      setUser(result.user);
      setMode(result.authenticated ? "authenticated" : "anonymous");
      setErrorMessage(null);
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
