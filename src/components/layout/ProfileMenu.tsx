"use client";

import { useState } from "react";
import { LogOut, MessageSquareText, UserRound } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PasswordAuthUser } from "@/lib/auth-api";
import type { OpenFeedback } from "@/lib/feedback-contracts";
import { cn } from "@/lib/utils";

type ProfileMenuProps = {
  currentUser?: PasswordAuthUser | null;
  projectId?: string;
  compact?: boolean;
  onOpenFeedback: OpenFeedback;
  onLogout?: () => Promise<void>;
  className?: string;
  align?: "start" | "end";
};

export function ProfileMenu({ currentUser, projectId, compact = false, onOpenFeedback, onLogout, className, align = "start" }: ProfileMenuProps) {
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
        <button
          type="button"
          data-feedback-origin="profile"
          onClick={openProfileFeedback}
          className="mt-1 flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-[#8fcbbb]/35"
        >
          <MessageSquareText className="h-4 w-4 text-muted-foreground" />
          反馈
        </button>
        {onLogout && (
          <button
            type="button"
            onClick={logout}
            className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-[#8fcbbb]/35"
          >
            <LogOut className="h-4 w-4 text-muted-foreground" />
            退出登录
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
