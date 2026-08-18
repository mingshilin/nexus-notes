import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ShareDialog } from "@/components/ui/ShareDialog";

function source(filePath: string) {
  return readFileSync(join(process.cwd(), filePath), "utf8");
}

afterEach(() => {
  cleanup();
});

describe("destructive confirmations", () => {
  it("disables destructive confirm actions while loading", () => {
    render(
      <ConfirmDialog
        open
        title="删除"
        description="确认删除"
        confirmLabel="删除"
        destructive
        loading
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "处理中..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });

  it("requires confirmation before revoking a public share", async () => {
    const onRevokePublicShare = vi.fn().mockResolvedValue(undefined);
    render(
      <ShareDialog
        open
        noteTitle="Project kickoff"
        canInvite={false}
        canCreatePublicShare
        publicShareSummary={{ active: true, expires_at: null }}
        onOpenChange={vi.fn()}
        onCopyDeepLink={vi.fn().mockResolvedValue(undefined)}
        onCreatePublicShare={vi.fn().mockResolvedValue({ share_url: "https://example.com/?share=abc" })}
        onRevokePublicShare={onRevokePublicShare}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "撤销当前独享链接" }));
    expect(onRevokePublicShare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "撤销链接" }));

    await waitFor(() => expect(onRevokePublicShare).toHaveBeenCalledTimes(1));
  });

  it("keeps app-level destructive operations behind confirmation state", () => {
    const app = source("src/App.tsx");
    const databasePage = source("src/components/database/DatabasePage.tsx");

    expect(app).toContain("emptyTrashOpen");
    expect(app).toContain("reminderDeleteTargetId");
    expect(app).toContain("noteDeleteLoading");
    expect(app).toContain("databaseDeleteLoading");
    expect(databasePage).toContain("deleteTemplateTargetId");
    expect(databasePage).toContain("deleteSavedViewTargetId");
    expect(databasePage).toContain("destructiveActionLoading");
  });
});
