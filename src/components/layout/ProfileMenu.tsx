"use client";

import { useState } from "react";
import { LogOut, MessageSquareText, SlidersHorizontal, UserRound, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MenuItem } from "@/components/ui/menu-item";
import type { PasswordAuthUser } from "@/lib/auth-api";
import type { OpenFeedback } from "@/lib/feedback-contracts";
import { cn } from "@/lib/utils";

type ProfileMenuProps = {
  currentUser?: PasswordAuthUser | null;
  projectId?: string;
  compact?: boolean;
  onOpenFeedback: OpenFeedback;
  onOpenUserManagement?: () => void;
  onLogout?: () => Promise<void>;
  onOpenXiaoKuSettings?: () => void;
  className?: string;
  align?: "start" | "end";
};

export function ProfileMenu({ currentUser, projectId, compact = false, onOpenFeedback, onOpenUserManagement, onLogout, onOpenXiaoKuSettings, className, align = "start" }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const displayName = currentUser?.displayName ?? "教师账户";

  function openProfileFeedback() {
    setOpen(false);
    onOpenFeedback({ origin: "profile", projectId });
  }

  function logout() {
    setOpen(false);
    if (onLogout) void onLogout();
  }

  function openUserManagement() {
    setOpen(false);
    onOpenUserManagement?.();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-profile-menu
          className={cn(
            "flex h-10 w-full items-center gap-3 rounded-md px-2 text-left text-sm text-foreground transition hover:bg-[#eeeeef] focus:outline-none focus:ring-2 focus:ring-[#8fcbbb]/35",
            compact && "justify-center px-0",
            className,
          )}
          aria-label="打开账户菜单"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground">
            <UserRound className="h-4 w-4" />
          </span>
          {!compact && <span className="min-w-0 flex-1 truncate">{displayName}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 rounded-lg p-1.5" align={align} sideOffset={6}>
        <div className="border-b px-2 py-2">
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
        </div>
        <MenuItem
          data-feedback-origin="profile"
          onClick={openProfileFeedback}
          className="mt-1"
          icon={<MessageSquareText className="h-4 w-4" />}
        >
          反馈
        </MenuItem>
        {onOpenXiaoKuSettings && (
          <MenuItem
            onClick={() => {
              setOpen(false);
              onOpenXiaoKuSettings();
            }}
            icon={<SlidersHorizontal className="h-4 w-4" />}
          >
            小酷偏好
          </MenuItem>
        )}
        {currentUser?.role === "admin" && onOpenUserManagement && (
          <MenuItem
            onClick={openUserManagement}
            icon={<Users className="h-4 w-4" />}
          >
            用户管理
          </MenuItem>
        )}
        {onLogout && (
          <MenuItem
            onClick={logout}
            icon={<LogOut className="h-4 w-4" />}
          >
            退出登录
          </MenuItem>
        )}
      </PopoverContent>
    </Popover>
  );
}
