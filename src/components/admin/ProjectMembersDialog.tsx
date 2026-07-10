"use client";

import { useEffect, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { PasswordAuthUser } from "@/lib/auth-api";
import { createUserManagementClient, type ProjectMember } from "@/lib/user-management-api";

type ProjectMembersDialogProps = {
  open: boolean;
  projectId?: string;
  currentUser?: PasswordAuthUser | null;
  onOpenChange: (open: boolean) => void;
};

const client = createUserManagementClient();

export function ProjectMembersDialog({ open, projectId, currentUser, onOpenChange }: ProjectMembersDialogProps) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const canManage = currentUser?.role === "admin" || members.some((member) => member.userId === currentUser?.id && member.role === "owner");

  useEffect(() => {
    if (open && projectId) void loadMembers();
  }, [open, projectId]);

  async function loadMembers() {
    if (!projectId) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await client.listProjectMembers(projectId);
      setMembers(result.items);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "成员列表暂时没有取回。");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: () => Promise<unknown>, success: string) {
    if (!projectId) return;
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus(success);
      await loadMembers();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "操作没有完成。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(680px,calc(100vw-24px))] p-0">
        <div className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base font-medium"><Users className="h-4 w-4" /> 协作成员</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">把项目分享给可编辑或可查看的教师。</DialogDescription>
        </div>
        <div className="max-h-[76vh] space-y-4 overflow-y-auto p-5">
          {canManage ? (
            <section className="rounded-md border p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium"><UserPlus className="h-4 w-4" /> 添加成员</div>
              <div className="grid gap-2 sm:grid-cols-[1fr_132px_auto]">
                <input className="h-9 min-w-0 rounded-md border px-3 text-sm" placeholder="教师邮箱" value={email} onChange={(event) => setEmail(event.target.value)} />
                <select className="h-9 rounded-md border px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value as "editor" | "viewer")}>
                  <option value="viewer">可查看</option>
                  <option value="editor">可编辑</option>
                </select>
                <Button size="sm" disabled={busy || !projectId || !email.trim()} onClick={() => runAction(() => client.addProjectMember(projectId!, { email, role }), "成员已添加。")}>添加</Button>
              </div>
            </section>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">你可以查看协作成员，只有项目拥有者或管理员可以调整成员。</p>
          )}
          {status && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{status}</p>}
          <section className="space-y-2">
            {members.map((member) => (
              <div key={member.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{member.displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">{member.email ?? "未填写邮箱"}</div>
                </div>
                <div className="flex items-center gap-2">
                  {member.role === "owner" || !canManage ? (
                    <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{memberRoleLabel(member.role)}</span>
                  ) : (
                    <>
                      <select className="h-9 rounded-md border px-3 text-sm" value={member.role} disabled={busy} onChange={(event) => runAction(() => client.updateProjectMember(projectId!, member.userId, event.target.value as "editor" | "viewer"), "成员权限已更新。")}>
                        <option value="viewer">可查看</option>
                        <option value="editor">可编辑</option>
                      </select>
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => runAction(() => client.removeProjectMember(projectId!, member.userId), "成员已移除。")}>移除</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function memberRoleLabel(role: ProjectMember["role"]) {
  if (role === "owner") return "拥有者";
  if (role === "editor") return "可编辑";
  return "可查看";
}
