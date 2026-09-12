import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/ui/App.js";

const state = {
  plugins: [
    {
      id: "browser@openai-bundled",
      name: "browser",
      displayName: "Browser",
      description: "Control the in-app browser",
      marketplace: "openai-bundled",
      installed: true,
      enabled: true,
    },
  ],
  mcpServers: [
    {
      id: "docs",
      name: "docs",
      transport: "http",
      detail: "https://example.com/mcp",
      enabled: true,
      scopes: ["global"],
    },
    {
      id: "project-tools",
      name: "project-tools",
      transport: "stdio",
      detail: "node",
      enabled: true,
      scopes: ["project"],
    },
  ],
  globalPluginConfig: [
    { id: "browser@openai-bundled", enabled: true },
  ],
  projectPluginConfig: {
    value: [],
    filePath: "/repo/.codex/config.toml",
  },
  globalMcpConfig: [
    { id: "docs", enabled: true },
  ],
  projectMcpConfig: {
    value: [{ id: "project-tools", enabled: false }],
    filePath: "/repo/.codex/config.toml",
  },
  skills: [
    { name: "Review", description: "Code checks", path: "/skills/review/SKILL.md", scope: "user", enabled: true },
    { name: "Deploy", description: "Review releases", path: "/skills/deploy/SKILL.md", scope: "repo", enabled: true },
    { name: "Report", description: "Status", path: "/skills/report/SKILL.md", scope: "user", enabled: false },
  ],
  globalDefaults: [
    { path: "/skills/review/SKILL.md", enabled: true },
    { path: "/skills/deploy/SKILL.md", enabled: true },
    { path: "/skills/report/SKILL.md", enabled: false },
  ],
  projectConfig: {
    value: [{ path: "/skills/report/SKILL.md", enabled: true }],
    filePath: "/repo/AGENTS.md",
    profileId: null,
  },
  projects: [
    { id: "project-1", name: "Current", rootPaths: ["/repo", "/repo-site"] },
    { id: "project-2", name: "Mineradio", rootPaths: ["/projects/Mineradio"] },
  ],
  profiles: [{
    id: "p1", name: "Daily", overrides: [
      { path: "/skills/deploy/SKILL.md", state: "enabled" },
      { path: "/skills/removed/SKILL.md", state: "disabled" },
    ],
    createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
  }],
  activeProfileId: null as string | null,
  writable: true,
};

const preferences = new Map<string, string>();

beforeEach(() => {
  preferences.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => preferences.get(key) ?? null,
      setItem: (key: string, value: string) => preferences.set(key, value),
      clear: () => preferences.clear(),
    },
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function createApi() {
  let currentState = state;
  return {
    call: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_skill_profile_state") return currentState;
      if (name === "apply_skill_configuration") {
        currentState = { ...currentState, activeProfileId: args.profileId as string | null };
        return { value: args.overrides };
      }
      if (name === "save_skill_profile") {
        return {
          profile: {
            id: (args.id as string | undefined) ?? "new-profile",
            name: args.name,
            overrides: args.overrides,
            createdAt: "2026-07-28T00:00:00.000Z",
            updatedAt: "2026-07-28T00:00:00.000Z",
          },
        };
      }
      return {};
    }),
  };
}

describe("Skill Session Profiles app", () => {
  it("switches language and theme and remembers both preferences", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");

    await userEvent.click(screen.getByRole("button", { name: "Switch to English" }));
    expect(screen.getByRole("button", { name: "Task Configuration" })).toBeTruthy();
    expect(localStorage.getItem("skill-session-profiles:language")).toBe("en");

    await userEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("skill-session-profiles:theme")).toBe("dark");
  });

  it("hides plugin and MCP controls", async () => {
    render(<App api={createApi()} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");

    expect(screen.queryByRole("navigation", { name: "资源类型" })).toBeNull();
    expect(screen.queryByRole("button", { name: "插件1" })).toBeNull();
    expect(screen.queryByRole("button", { name: "MCP2" })).toBeNull();
    expect(screen.getByRole("button", { name: "任务配置" })).toBeTruthy();
  });

  it("offers complete profile management actions", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    expect(screen.queryByRole("button", { name: "配置方案" })).toBeNull();
    expect(screen.getByRole("button", { name: "编辑 Daily" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制 Daily" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "导入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "导出" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "编辑 Daily" }));
    expect(screen.getByRole("combobox", { name: "Skill 来源" })).toBeTruthy();
  });

  it("searches shared skill configuration by name only", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");

    const search = screen.getByRole("textbox", { name: "搜索 skill" });
    await userEvent.type(search, "Code checks");

    expect(screen.queryByText("Review", { exact: true })).toBeNull();
    expect(screen.getByText("没有匹配的 Skill")).toBeTruthy();
    expect((screen.getByRole("button", { name: "全部继承（0）" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "全部启用（0）" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "全部禁用（0）" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the effective state beside inherited skill settings", async () => {
    render(<App api={createApi()} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");

    expect((within(screen.getByRole("group", { name: "Review 设置" }))
      .getByRole("radio", { name: "继承（开启）" }) as HTMLInputElement).checked).toBe(true);
    expect((within(screen.getByRole("group", { name: "Report 设置" }))
      .getByRole("radio", { name: "继承（关闭）" }) as HTMLInputElement).checked).toBe(true);
  });

  it("bulk-disables only visible skills and preserves hidden overrides", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    await userEvent.click(screen.getByRole("button", { name: "编辑 Daily" }));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Skill 来源" }),
      "user",
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "搜索 skill" }),
      "Re",
    );
    await userEvent.click(screen.getByRole("button", { name: "全部禁用（2）" }));
    await userEvent.click(screen.getByRole("button", { name: "保存方案" }));

    expect(api.call).toHaveBeenCalledWith("save_skill_profile", {
      id: "p1",
      name: "Daily",
      overrides: [
        { path: "/skills/deploy/SKILL.md", state: "enabled" },
        { path: "/skills/removed/SKILL.md", state: "disabled" },
        { path: "/skills/review/SKILL.md", state: "disabled" },
        { path: "/skills/report/SKILL.md", state: "disabled" },
      ],
    });
  });

  it("persists the selected profile for all later tasks", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    expect(screen.getByText("使用中").closest("button")?.textContent).toContain("继承全局默认");
    await userEvent.click(screen.getByRole("button", { name: /Daily1 当前 · 1 失效/ }));
    expect(screen.getByText("使用中").closest("button")?.textContent).toContain("继承全局默认");
    await userEvent.click(screen.getByRole("button", { name: "应用此配置" }));

    expect(api.call).toHaveBeenCalledWith("apply_skill_configuration", {
      cwd: "/repo",
      profileId: "p1",
      overrides: [{ path: "/skills/deploy/SKILL.md", state: "enabled" }],
    });
    expect((await screen.findByText("使用中")).closest("button")?.textContent).toContain("Daily");
    expect(screen.getByText("配置已应用。后续打开的所有任务都会沿用此配置。")).toBeTruthy();
  });

  it("does not reset draft settings when the selected profile is clicked again", async () => {
    render(<App api={createApi()} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    const profile = screen.getByRole("button", { name: /Daily1 当前 · 1 失效/ });
    await userEvent.click(profile);
    const review = screen.getByRole("group", { name: "Review 设置" });
    await userEvent.click(within(review).getByRole("radio", { name: "停用" }));
    await userEvent.click(profile);

    expect((within(review).getByRole("radio", { name: "停用" }) as HTMLInputElement).checked).toBe(true);
  });

  it("saves overrides for the selected project", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    await userEvent.click(screen.getByRole("button", { name: "项目配置" }));
    const reportSetting = screen.getByRole("group", { name: "Report 设置" });
    await userEvent.click(reportSetting.querySelectorAll("input")[2]!);
    await userEvent.click(screen.getByRole("button", { name: "保存项目配置" }));

    expect(api.call).toHaveBeenCalledWith("save_project_skill_configuration", {
      cwd: "/repo",
      overrides: [{ path: "/skills/report/SKILL.md", state: "disabled" }],
      compatibilityMode: true,
      profileId: null,
    });
  });

  it("bulk-inherits only visible project skills", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    await userEvent.click(screen.getByRole("button", { name: "项目配置" }));
    await userEvent.type(screen.getByRole("textbox", { name: "搜索 skill" }), "Report");
    await userEvent.click(screen.getByRole("button", { name: "全部继承（1）" }));
    await userEvent.click(screen.getByRole("button", { name: "保存项目配置" }));

    expect(api.call).toHaveBeenCalledWith("save_project_skill_configuration", {
      cwd: "/repo",
      overrides: [],
      compatibilityMode: true,
      profileId: null,
    });
  });

  it("binds project configuration to a task profile", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    await userEvent.click(screen.getByRole("button", { name: "项目配置" }));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "配置方式" }),
      "profile",
    );

    expect((screen.getByRole("combobox", { name: "任务配置" }) as HTMLSelectElement).value).toBe("p1");
    expect((within(screen.getByRole("group", { name: "Deploy 设置" }))
      .getByRole("radio", { name: "启用" }) as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "保存项目配置" }));

    expect(api.call).toHaveBeenCalledWith("save_project_skill_configuration", {
      cwd: "/repo",
      overrides: [{ path: "/skills/deploy/SKILL.md", state: "enabled" }],
      compatibilityMode: true,
      profileId: "p1",
    });
  });

  it("persists native project mode and saves skills.config overrides", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    await userEvent.click(screen.getByRole("button", { name: "项目配置" }));

    await userEvent.click(screen.getByRole("checkbox", { name: "兼容模式" }));
    expect(localStorage.getItem("skill-session-profiles:project-skill-mode")).toBe("native");
    expect(api.call).toHaveBeenCalledWith("get_skill_profile_state", {
      cwd: "/repo",
      compatibilityMode: false,
    });

    const reportSetting = screen.getByRole("group", { name: "Report 设置" });
    await userEvent.click(reportSetting.querySelectorAll("input")[2]!);
    await userEvent.click(screen.getByRole("button", { name: "保存项目配置" }));

    expect(api.call).toHaveBeenCalledWith("save_project_skill_configuration", {
      cwd: "/repo",
      overrides: [{ path: "/skills/report/SKILL.md", state: "disabled" }],
      compatibilityMode: false,
      profileId: null,
    });
  });

  it("selects a project from the Codex project list", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    await userEvent.click(screen.getByRole("button", { name: "项目配置" }));
    expect(screen.getByRole("button", { name: /Mineradio/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Mineradio/ }));
    expect(api.call).toHaveBeenCalledWith("get_skill_profile_state", {
      cwd: "/projects/Mineradio",
      compatibilityMode: true,
    });
  });

  it("keeps the current project visible while another project loads", async () => {
    let resolveProject!: (value: typeof state) => void;
    const projectState = new Promise<typeof state>((resolve) => {
      resolveProject = resolve;
    });
    const api = createApi();
    api.call.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_skill_profile_state" && args.cwd === "/projects/Mineradio") {
        return projectState;
      }
      if (name === "get_skill_profile_state") return state;
      return {};
    });

    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    await userEvent.click(screen.getByRole("button", { name: "项目配置" }));
    expect(screen.getByText("Report", { exact: true })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Mineradio/ }));

    expect(screen.getByText("Report", { exact: true })).toBeTruthy();
    expect(screen.queryByText("正在读取 Skill 配置…")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "正在切换项目…" })).toBeTruthy();
    expect(screen.getByText("正在切换项目…")).toBeTruthy();

    resolveProject({ ...state, projectConfig: { ...state.projectConfig, value: [] } });
    expect(await screen.findByText("更改已保存")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("cleans stale profile overrides only when the edited profile is saved", async () => {
    const api = createApi();
    render(<App api={api} cwd="/repo" />);
    await screen.findByText("Skill Session Profiles");
    await userEvent.click(screen.getByRole("button", { name: "编辑 Daily" }));

    expect(screen.getByText("1 项覆盖已不在当前 Skill 列表中。")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "清理失效覆盖（1）" }));
    expect(screen.queryByText("1 项覆盖已不在当前 Skill 列表中。")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "保存方案" }));

    expect(api.call).toHaveBeenCalledWith("save_skill_profile", {
      id: "p1",
      name: "Daily",
      overrides: [{ path: "/skills/deploy/SKILL.md", state: "enabled" }],
    });
  });
});
