"use client";

import { FormEvent, useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

type PasswordAuthGateProps = {
  errorMessage: string | null;
  submitting: boolean;
  onLogin: (input: { email: string; password: string }) => Promise<void>;
  onRegister: (input: { email: string; displayName?: string; password: string }) => Promise<void>;
};

export function PasswordAuthGate({ errorMessage, submitting, onLogin, onRegister }: PasswordAuthGateProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "register") {
      await onRegister({ email, displayName, password });
      return;
    }
    await onLogin({ email, password });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-card px-4 py-10">
      <section className="w-full max-w-[380px]">
        <div className="mb-8 space-y-2">
          <p className="text-sm text-muted-foreground">ShanHaiEdu / 公开课备课</p>
          <h1 className="text-[28px] font-semibold leading-tight tracking-normal text-foreground">登录 ShanHaiEdu</h1>
          <p className="text-sm leading-6 text-muted-foreground">进入你的公开课材料工作台。</p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-md border bg-muted p-1">
          <button
            type="button"
            className={`h-8 rounded text-sm ${mode === "login" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            onClick={() => setMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={`h-8 rounded text-sm ${mode === "register" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            onClick={() => setMode("register")}
          >
            创建账号
          </button>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">邮箱</span>
            <input
              className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          {mode === "register" && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">显示名</span>
              <input
                className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">密码</span>
            <input
              className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {errorMessage && <p className="rounded-md bg-[#f5f5f5] px-3 py-2 text-sm text-muted-foreground">{errorMessage}</p>}

          <Button className="w-full" type="submit" disabled={submitting}>
            {mode === "register" ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
            {submitting ? "请稍候" : mode === "register" ? "创建并进入" : "登录"}
          </Button>
        </form>
      </section>
    </main>
  );
}
