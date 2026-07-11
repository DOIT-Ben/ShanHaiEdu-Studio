"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createUserManagementClient, type ManagedUser } from "@/lib/user-management-api";

type AdminUserManagementDialogProps = {
  open: boolean;
  currentUserId?: string;
  onOpenChange: (open: boolean) => void;
};

const client = createUserManagementClient();

export function AdminUserManagementDialog({ open, currentUserId, onOpenChange }: AdminUserManagementDialogProps) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({ email: "", displayName: "", initialPassword: "", role: "teacher" as "teacher" | "admin" });
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});

  const filteredUsers = useMemo(() => users, [users]);

  useEffect(() => {
    if (open) void loadUsers();
  }, [open]);

  async function loadUsers(nextQuery = query) {
    setBusy(true);
    setStatus(null);
    try {
      const result = await client.listUsers(nextQuery);
      setUsers(result.items);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "用户列表暂时没有取回。");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus(success);
      await loadUsers();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "操作没有完成。");
    } finally {
      setBusy(false);
    }
  }

  async function inviteUser() {
    await runAction(async () => {
      await client.inviteUser(invite);
      setInvite({ email: "", displayName: "", initialPassword: "", role: "teacher" });
    }, "账号已创建。");
  }

  async function resetPassword(userId: string) {
    await runAction(async () => {
      await client.resetPassword(userId, resetPasswords[userId]);
      setResetPasswords((current) => ({ ...current, [userId]: "" }));
    }, "密码已重置。");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(920px,calc(100vw-24px))] p-0">
        <div className="border-b px-5 py-4">
          <DialogTitle className="text-base font-medium">用户管理</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">分配内测账号，管理登录状态和会话。</DialogDescription>
        </div>
        <div className="grid max-h-[76vh] gap-4 overflow-y-auto p-5 lg:grid-cols-[300px_1fr]">
          <section className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium"><UserPlus className="h-4 w-4" /> 新账号</div>
              <Input className="mb-2" inputSize="sm" type="email" placeholder="邮箱" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} />
              <Input className="mb-2" inputSize="sm" placeholder="姓名" value={invite.displayName} onChange={(event) => setInvite({ ...invite, displayName: event.target.value })} />
              <Input className="mb-2" inputSize="sm" placeholder="初始密码" type="password" value={invite.initialPassword} onChange={(event) => setInvite({ ...invite, initialPassword: event.target.value })} />
              <Select value={invite.role} onValueChange={(value) => setInvite({ ...invite, role: value as "teacher" | "admin" })}>
                <SelectTrigger className="mb-3 w-full" aria-label="账号角色"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="teacher">教师</SelectItem><SelectItem value="admin">管理员</SelectItem></SelectContent>
              </Select>
              <Button className="w-full" size="sm" disabled={busy} onClick={inviteUser}>创建账号</Button>
            </div>
            <label className="flex h-11 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm focus-within:border-[#68a999] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 focus-visible:ring-0" placeholder="搜索用户" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && loadUsers(event.currentTarget.value)} />
            </label>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => loadUsers()}><RefreshCw className="h-4 w-4" />刷新</Button>
            {status && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{status}</p>}
          </section>
          <section className="space-y-2">
            {filteredUsers.map((user) => (
              <div key={user.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{user.displayName}</div>
                    <div className="truncate text-xs text-muted-foreground">{user.email ?? "未填写邮箱"}</div>
                  </div>
                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{user.status === "disabled" ? "已停用" : user.role === "admin" ? "管理员" : "教师"}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" disabled={busy || user.id === currentUserId} onClick={() => runAction(() => client.updateUser(user.id, { disabled: user.status !== "disabled", reason: "管理员调整" }), user.status === "disabled" ? "账号已启用。" : "账号已停用。")}>{user.status === "disabled" ? "启用" : "停用"}</Button>
                  <Button variant="secondary" size="sm" disabled={busy || user.id === currentUserId} onClick={() => runAction(() => client.updateUser(user.id, { role: user.role === "admin" ? "teacher" : "admin" }), "角色已更新。")}>{user.role === "admin" ? "设为教师" : "设为管理员"}</Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => runAction(() => client.revokeSessions(user.id), "会话已撤销。")}>撤销会话</Button>
                </div>
                <div className="mt-3 flex gap-2">
                  <Input className="min-w-0 flex-1" inputSize="sm" type="password" placeholder="新初始密码" value={resetPasswords[user.id] ?? ""} onChange={(event) => setResetPasswords({ ...resetPasswords, [user.id]: event.target.value })} />
                  <Button size="sm" disabled={busy || !(resetPasswords[user.id] ?? "").trim()} onClick={() => resetPassword(user.id)}>重置</Button>
                </div>
              </div>
            ))}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
