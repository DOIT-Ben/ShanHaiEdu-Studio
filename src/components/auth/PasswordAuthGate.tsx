"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PasswordAuthGateProps = {
  errorMessage: string | null;
  submitting: boolean;
  registrationEnabled: boolean;
  onLogin: (input: { email: string; password: string }) => Promise<void>;
  onRegister: (input: { email: string; displayName?: string; password: string }) => Promise<void>;
};

export function PasswordAuthGate({ errorMessage, submitting, registrationEnabled, onLogin, onRegister }: PasswordAuthGateProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const isRegisterMode = registrationEnabled && mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRegisterMode) {
      await onRegister({ email, displayName, password });
      return;
    }
    await onLogin({ email, password });
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-card lg:grid lg:h-screen lg:grid-cols-[54%_46%]">
      <section className="relative hidden min-h-0 overflow-hidden bg-[#0d2940] lg:block" aria-label="山海课伴品牌介绍">
        <Image
          src="/brand/auth-teacher-cover.png"
          alt="阳光下摆放着书本与教学用具的备课桌面"
          fill
          priority
          sizes="54vw"
          className="object-cover"
        />
        <div data-auth-welcome-light className="pointer-events-none absolute inset-0 bg-white/10" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 bg-[#0d2940]/88 px-10 pb-9 pt-20 text-white xl:px-14 xl:pb-11">
          <p className="text-[30px] font-semibold leading-tight tracking-tight">把一节课，准备得更从容。</p>
          <p className="mt-3 text-base font-medium text-white/90">面向小学教师的 AI 备课与课堂材料工作台</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/72">懂教材，也懂课堂的 AI 备课助手。</p>
        </div>
      </section>

      <section className="flex min-h-screen min-w-0 flex-col bg-card lg:min-h-0 lg:justify-center">
        <div className="relative h-40 overflow-hidden bg-[#0d2940] lg:hidden">
          <Image
            src="/brand/auth-teacher-cover.png"
            alt="阳光下摆放着书本与教学用具的备课桌面"
            fill
            priority
            sizes="100vw"
            className="object-cover object-[center_42%]"
          />
          <div className="absolute inset-0 bg-[#0d2940]/20" />
        </div>

        <div className="mx-auto w-full max-w-[420px] px-5 py-7 sm:px-8 lg:px-6 lg:py-8">
          <div data-auth-brand-signature className="mb-6 flex items-center gap-5 border-b border-border/70 pb-5">
            <Image src="/brand/shanhai-education-logo.png" alt="山海教育" width={92} height={92} className="h-[92px] w-[92px] shrink-0 object-contain" />
            <div className="min-w-0">
              <p className="text-[23px] font-semibold leading-tight tracking-[-0.035em] text-[#0d2940]">山海课伴</p>
              <p className="mt-2 text-xs tracking-[0.08em] text-muted-foreground">山海教育 · AI 备课工作台</p>
            </div>
          </div>

          <div data-auth-welcome-copy className="mb-6 space-y-2">
            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.025em] text-foreground">
              {isRegisterMode ? "创建你的教师账号" : "欢迎回来"}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {isRegisterMode ? "创建账号后，回到自己的备课项目继续准备课堂材料。" : "登录后，回到自己的备课项目继续准备课堂材料。"}
            </p>
            {!isRegisterMode && <p className="pt-1 text-sm font-medium text-[#32685d]">今天也一起，从容备好一节课。</p>}
          </div>

          {registrationEnabled && (
            <div className="mb-5 grid grid-cols-2 border-b" aria-label="认证方式">
              <button
                type="button"
                aria-pressed={mode === "login"}
                disabled={submitting}
                className={`h-11 border-b-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:opacity-45 ${mode === "login" ? "border-[#0d5370] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                onClick={() => setMode("login")}
              >
                登录
              </button>
              <button
                type="button"
                aria-pressed={mode === "register"}
                disabled={submitting}
                className={`h-11 border-b-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:opacity-45 ${mode === "register" ? "border-[#0d5370] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                onClick={() => setMode("register")}
              >
                创建账号
              </button>
            </div>
          )}

          <form className="space-y-4" onSubmit={submit}>
            <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">账号</span>
            <Input
              autoFocus
              autoComplete="username"
              inputMode="text"
              placeholder="请输入账号"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            </label>

            {isRegisterMode && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">显示名</span>
              <Input
                autoComplete="name"
                placeholder="例如：林老师"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            )}

            <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">密码</span>
            <Input
              type="password"
              autoComplete={isRegisterMode ? "new-password" : "current-password"}
              placeholder={isRegisterMode ? "请设置至少 8 位密码" : "请输入密码"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            </label>

            {errorMessage && <p className="rounded-md bg-[#f5f5f5] px-3 py-2 text-sm text-muted-foreground">{errorMessage}</p>}

            <Button className="h-11 w-full bg-[#0d5370] text-white hover:bg-[#0a465f] active:bg-[#083a50]" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isRegisterMode ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              {submitting ? (isRegisterMode ? "正在创建教师账号" : "正在进入你的备课空间") : isRegisterMode ? "创建并进入" : "登录"}
            </Button>
          </form>

          <p className="mt-5 text-xs leading-5 text-muted-foreground">你的项目与材料仅对你和被邀请的协作者可见。</p>
        </div>
      </section>
    </main>
  );
}
