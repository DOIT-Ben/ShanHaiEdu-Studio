import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";
import { PasswordAuthGate, isPasswordRegistrationMode } from "@/components/auth/PasswordAuthGate";

const noopAsync = async () => undefined;

describe("M74 branded auth runtime", () => {
  it("renders the approved teacher-facing login surface", () => {
    const markup = renderToStaticMarkup(createElement(PasswordAuthGate, {
      errorMessage: null,
      submitting: false,
      registrationEnabled: false,
      onLogin: noopAsync,
      onRegister: noopAsync,
    }));

    expect(markup).toContain("山海课伴");
    expect(markup).toContain("山海教育 · AI 备课工作台");
    expect(markup).toContain("欢迎回来");
    expect(markup).toContain("面向小学教师的 AI 备课与课堂材料工作台");
    expect(markup).toContain("你的项目与材料仅对你和被邀请的协作者可见。");
    expect(markup).not.toContain("山海智教智能体");
    expect(markup).not.toContain("创建你的教师账号");
  });

  it("keeps registration mode gated by the runtime feature flag", () => {
    expect(isPasswordRegistrationMode(false, "register")).toBe(false);
    expect(isPasswordRegistrationMode(true, "login")).toBe(false);
    expect(isPasswordRegistrationMode(true, "register")).toBe(true);
  });

  it("keeps the default input touch target stable", () => {
    const markup = renderToStaticMarkup(createElement(Input, { placeholder: "账号" }));
    expect(markup).toContain("h-11");
  });
});
