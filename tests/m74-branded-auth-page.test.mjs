import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(path.join(process.cwd(), "src", "components", "auth", "PasswordAuthGate.tsx"), "utf8");
const inputSource = readFileSync(path.join(process.cwd(), "src", "components", "ui", "input.tsx"), "utf8");

test("M74 uses the approved brand assets and concrete teacher positioning", () => {
  assert.match(source, /from "next\/image"/);
  assert.match(source, /src="\/brand\/auth-teacher-cover\.png"/);
  assert.match(source, /src="\/brand\/shanhai-education-logo\.png"/);
  assert.match(source, /fill[\s\S]*sizes="54vw"[\s\S]*className="object-cover"/);
  assert.match(source, /把一节课，准备得更从容。/);
  assert.match(source, /面向小学教师的 AI 备课与课堂材料工作台/);
  assert.match(source, /懂教材，也懂课堂的 AI 备课助手。/);
  assert.match(source, />山海课伴</);
  assert.match(source, /山海教育 · AI 备课工作台/);
  assert.doesNotMatch(source, /山海智教智能体/);
});

test("M74 keeps registration runtime-gated with dynamic accessible mode controls", () => {
  assert.match(source, /const isRegisterMode = registrationEnabled && mode === "register"/);
  assert.match(source, /registrationEnabled && \(/);
  assert.match(source, /aria-pressed=\{mode === "login"\}/);
  assert.match(source, /aria-pressed=\{mode === "register"\}/);
  assert.match(source, /isRegisterMode \? "创建你的教师账号" : "欢迎回来"/);
  assert.match(source, /登录后，回到自己的备课项目继续准备课堂材料。/);
  assert.match(source, /if \(isRegisterMode\)[\s\S]*onRegister\(\{ email, displayName, password \}\)[\s\S]*onLogin\(\{ email, password \}\)/);
});

test("M74 preserves field order, browser hints, state feedback, and touch sizing", () => {
  const accountIndex = source.indexOf(">账号<");
  const displayNameIndex = source.indexOf(">显示名<");
  const passwordIndex = source.indexOf(">密码<");
  assert.ok(accountIndex > -1 && accountIndex < displayNameIndex && displayNameIndex < passwordIndex);
  assert.match(source, /autoFocus/);
  assert.match(source, /autoComplete="username"/);
  assert.match(source, /autoComplete="name"/);
  assert.match(source, /autoComplete=\{isRegisterMode \? "new-password" : "current-password"\}/);
  assert.match(source, /请设置至少 8 位密码/);
  assert.match(source, /errorMessage &&/);
  assert.match(source, /disabled=\{submitting\}/);
  assert.match(source, /submitting \? \(isRegisterMode \? "正在创建教师账号" : "正在进入你的备课空间"\)/);
  assert.ok((source.match(/h-11/g) ?? []).length >= 3);
  assert.match(inputSource, /inputSize === "default" \? "h-11"/);
});

test("M74 provides desktop split layout and a restrained mobile brand header", () => {
  assert.match(source, /overflow-x-hidden/);
  assert.match(source, /lg:grid-cols-\[54%_46%\]/);
  assert.match(source, /hidden[^"]*lg:block/);
  assert.match(source, /h-40[^"]*lg:hidden/);
  assert.match(source, /max-w-\[420px\]/);
  assert.match(source, /border-b border-border\/70 pb-5/);
  assert.doesNotMatch(source, /backdrop-blur|bg-gradient|gradient-to-/);
});

test("M74 uses a truthful privacy note without invented trust claims", () => {
  assert.match(source, /你的项目与材料仅对你和被邀请的协作者可见。/);
  assert.doesNotMatch(source, /云端加密|学校认证|教育局认证|军工级|银行级/);
});

test("M74 adds a restrained one-shot welcome moment with reduced-motion support", () => {
  const globalCss = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
  assert.match(source, /data-auth-brand-signature/);
  assert.match(source, /data-auth-welcome-copy/);
  assert.match(source, /data-auth-welcome-light/);
  assert.match(source, /今天也一起，从容备好一节课。/);
  assert.match(source, /正在进入你的备课空间/);
  assert.match(globalCss, /@keyframes auth-brand-arrive/);
  assert.match(globalCss, /@keyframes auth-light-breathe/);
  assert.match(globalCss, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(globalCss, /\[data-auth-[^\]]+\][^{]*\{[^}]*infinite/s);
});
