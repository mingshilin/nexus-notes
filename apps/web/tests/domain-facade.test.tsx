import { createRef, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/app/workspace-domain-loader", () => ({
  loadDatabaseWorkbench: async () => ({
    DatabaseWorkbench: ({ database }: { database: { name: string } }) => <section aria-label="数据库 facade">{database.name}</section>,
  }),
  loadKnowledgeSearchPanel: async () => ({ KnowledgeSearchPanel: () => <section aria-label="知识搜索 facade">知识搜索</section> }),
  loadKnowledgeGraphPanel: async () => ({ KnowledgeGraphPanel: () => <section aria-label="知识图谱 facade">知识图谱</section> }),
  loadKnowledgeCalendarPanel: async () => ({ KnowledgeCalendarPanel: () => <section aria-label="知识日历 facade">知识日历</section> }),
  loadAccountCenter: async () => ({ AccountCenter: ({ onWorkspaceChange }: { onWorkspaceChange(workspaceId: string): void }) => <section aria-label="账户 facade"><button type="button" onClick={() => onWorkspaceChange("ws-2")}>切换工作区</button></section> }),
  loadAIChatPanel: async () => ({ AIChatPanel: () => <section aria-label="AI facade">AI</section> }),
  loadCollaborationCenter: async () => ({ CollaborationCenter: () => <section aria-label="协作 facade">协作内容</section> }),
}));

import { AccountAndAIDomain, type AccountAndAIDomainCallbacks } from "../src/app/domains/AccountAndAIDomain";
import { CollaborationDomain, CollaborationNotificationSurface } from "../src/app/domains/CollaborationDomain";
import { DatabaseDomain, type DatabaseDomainCallbacks } from "../src/app/domains/DatabaseDomain";
import { KnowledgeDomain } from "../src/app/domains/KnowledgeDomain";
import { NotesDomain, type NotesDomainCallbacks } from "../src/app/domains/NotesDomain";
import { WorkspaceShell } from "../src/app/WorkspaceShell";

function callbackProxy<T extends object>() {
  const callbacks = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return {
    value: new Proxy({}, {
      get(_target, property) {
        const existing = callbacks.get(property);
        if (existing) return existing;
        const callback = vi.fn();
        callbacks.set(property, callback);
        return callback;
      },
    }) as T,
    get(property: keyof T) {
      return callbacks.get(property) ?? vi.fn();
    },
  };
}

function notesFacade(callbacks: NotesDomainCallbacks, recoveryContent: ReactNode = null) {
  return <NotesDomain
    client={{ request: vi.fn() } as never}
    workspaceId="ws-1"
    role="owner"
    selectedEntity={{
      featureMapOpen: false,
      editor: null,
      overview: {
        workbenchMode: "desktop",
        workspaceAvailable: true,
        folders: [],
        selectedFolderId: null,
        folderLoading: false,
        logoutPending: false,
        activePane: "canvas",
        noteError: null,
        collaborationEnabled: true,
        unreadCount: 0,
        recoveryContent,
        headingRef: createRef<HTMLHeadingElement>(),
      },
    }}
    callbacks={callbacks}
  />;
}

function databaseFacade(callbacks: DatabaseDomainCallbacks) {
  return <DatabaseDomain
    client={{ database: {}, collaboration: {} } as never}
    workspaceId="ws-1"
    role="owner"
    selectedEntity={{
      bundle: null,
      databases: [],
      records: [],
      recordsNextCursor: null,
      loading: false,
      error: null,
      firstDatabaseName: "",
      creatingFirstDatabase: false,
    }}
    callbacks={callbacks}
  />;
}

describe("workspace domain facades", () => {
  it("renders Notes, Knowledge, Database, and AI facades independently with scoped clients", async () => {
    const notesCallbacks = callbackProxy<NotesDomainCallbacks>();
    const notes = render(notesFacade(notesCallbacks.value, <section aria-label="笔记恢复 facade">恢复</section>));
    expect(screen.getByRole("heading", { name: "Public Beta 重写计划" })).toBeVisible();
    expect(screen.getByRole("region", { name: "笔记恢复 facade" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "新建笔记" }));
    expect(notesCallbacks.get("onStartNewNote")).toHaveBeenCalledOnce();
    notes.unmount();

    const knowledge = render(<KnowledgeDomain
      client={{} as never}
      workspaceId="ws-1"
      role="editor"
      selectedEntity={{ recoveryContent: <section aria-label="恢复 facade">恢复</section> }}
      callbacks={{}}
    />);
    expect(await screen.findByRole("region", { name: "知识搜索 facade" })).toBeVisible();
    expect(screen.getByRole("region", { name: "恢复 facade" })).toBeVisible();
    knowledge.unmount();

    const databaseCallbacks = callbackProxy<DatabaseDomainCallbacks>();
    const database = render(databaseFacade(databaseCallbacks.value));
    expect(screen.getByRole("heading", { name: "创建第一个数据库" })).toBeVisible();
    database.unmount();

    render(<DatabaseDomain
      client={{ database: {}, collaboration: {} } as never}
      workspaceId="ws-1"
      role="owner"
      selectedEntity={{
        bundle: { database: { name: "Loaded database" } } as never,
        databases: [],
        records: [],
        recordsNextCursor: null,
        loading: false,
        error: null,
        firstDatabaseName: "",
        creatingFirstDatabase: false,
      }}
      callbacks={databaseCallbacks.value}
    />);
    expect(await screen.findByRole("region", { name: "数据库 facade" })).toHaveTextContent("Loaded database");

    const accountCallbacks = callbackProxy<AccountAndAIDomainCallbacks>();
    render(<AccountAndAIDomain
      client={{ api: {}, profile: {}, collaboration: {}, operations: {} } as never}
      workspaceId="ws-1"
      role="owner"
      selectedEntity={{ kind: "ai" }}
      callbacks={accountCallbacks.value}
    />);
    expect(await screen.findByRole("region", { name: "AI facade" })).toBeVisible();

    const account = render(<AccountAndAIDomain
      client={{ api: {}, profile: {}, collaboration: {}, operations: {} } as never}
      workspaceId="ws-1"
      role="owner"
      selectedEntity={{ kind: "account", workspaces: [], activeWorkspaceId: "ws-1", currentUserId: "user-1", initialTab: "overview" }}
      callbacks={accountCallbacks.value}
    />);
    fireEvent.click(await screen.findByRole("button", { name: "切换工作区" }));
    expect(accountCallbacks.get("onWorkspaceChange")).toHaveBeenCalledWith("ws-2");
    account.unmount();
  });

  it("switches domain content without unmounting the stable workspace navigation shell", () => {
    const notesCallbacks = callbackProxy<NotesDomainCallbacks>();
    const databaseCallbacks = callbackProxy<DatabaseDomainCallbacks>();
    const navigation = <div data-testid="stable-workspace-navigation">导航</div>;
    const view = render(<WorkspaceShell
      activeDomain="notes"
      requestedDomain="notes"
      domainPending={false}
      mode="desktop"
      navigation={navigation}
      inspectorOpen={false}
      onInspectorClose={vi.fn()}
    >
      {notesFacade(notesCallbacks.value)}
    </WorkspaceShell>);
    const stableNavigation = screen.getByTestId("stable-workspace-navigation");

    view.rerender(<WorkspaceShell
      activeDomain="databases"
      requestedDomain="databases"
      domainPending={false}
      mode="desktop"
      navigation={navigation}
      inspectorOpen={false}
      onInspectorClose={vi.fn()}
    >
      {databaseFacade(databaseCallbacks.value)}
    </WorkspaceShell>);

    expect(screen.getByTestId("stable-workspace-navigation")).toBe(stableNavigation);
    expect(screen.getByRole("heading", { name: "创建第一个数据库" })).toBeVisible();
  });

  it("keeps one notification surface while toggling the collaboration facade", async () => {
    const client = {
      listNotifications: vi.fn(async () => ({ items: [], next_cursor: null })),
      readNotification: vi.fn(),
      readNotifications: vi.fn(),
      readAllNotifications: vi.fn(),
    };
    const notificationProps = {
      client: client as never,
      workspaceId: "ws-1",
      userId: "user-1",
      unreadCount: 0,
      notificationOpener: null,
      onNotificationClose: vi.fn(),
      onNotificationRead: vi.fn(),
      onNotificationDeepLink: vi.fn(),
    };
    const view = render(<><div><CollaborationDomain client={client as never} workspaceId="ws-1" userId="user-1" role="owner" initialSection="people" /></div><CollaborationNotificationSurface {...notificationProps} notificationOpen={false} /></>);
    expect(await screen.findByRole("region", { name: "协作 facade" })).toBeVisible();

    view.rerender(<><div /> <CollaborationNotificationSurface {...notificationProps} notificationOpen /></>);
    expect(screen.queryByRole("region", { name: "协作 facade" })).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "通知中心" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog", { name: "通知中心" })).toHaveLength(1);
  });

  it("shows a recoverable deep-link error without creating an actionable target", async () => {
    render(<CollaborationDomain
      client={{} as never}
      workspaceId="ws-1"
      userId="user-1"
      role="owner"
      initialSection="comments"
      targetError="无法定位通知中的数据库记录。"
      commentTargets={[]}
      shareTargets={[]}
    />);

    expect(await screen.findByRole("alert")).toHaveTextContent("无法定位通知中的数据库记录。");
    expect(screen.queryByRole("combobox", { name: "评论目标" })).not.toBeInTheDocument();
  });
});
