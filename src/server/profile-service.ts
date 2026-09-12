import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";

import type { AppServerClient } from "./app-server-client.js";
import { extractProjectSkillLayer, extractUserSkillLayer } from "./config-layer.js";
import { JsonStore } from "./json-store.js";
import { readProjectSkillPolicy, replaceProjectSkillPolicy } from "./project-agents.js";
import { replaceProjectSkillConfig } from "./project-config.js";
import {
  skillProfileSchema,
  type ProfilesFile,
  type SkillConfigEntry,
  type SkillOverride,
  type SkillProfile,
} from "../shared/contracts.js";

export function canonicalize(entries: SkillConfigEntry[]): SkillConfigEntry[] {
  const bySelector = new Map<string, SkillConfigEntry>();
  for (const entry of entries) {
    if (entry.path !== undefined) {
      const normalized = normalize(entry.path);
      const path = basename(normalized) === "SKILL.md"
        ? normalized
        : join(normalized, "SKILL.md");
      if (!isAbsolute(path)) throw new Error(`skill path must be absolute: ${entry.path}`);
      bySelector.set(`path:${path}`, { ...entry, path });
    } else {
      bySelector.set(`name:${entry.name}`, entry);
    }
  }
  return [...bySelector.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, entry]) => entry);
}

export function resolveTarget(
  baseline: SkillConfigEntry[],
  overrides: SkillOverride[],
): SkillConfigEntry[] {
  const result = new Map(canonicalize(baseline).map((entry) => [
    entry.path === undefined ? `name:${entry.name}` : `path:${entry.path}`,
    entry,
  ]));
  for (const override of overrides) {
    const normalized = normalize(override.path);
    const path = basename(normalized) === "SKILL.md"
      ? normalized
      : join(normalized, "SKILL.md");
    if (!isAbsolute(path)) throw new Error(`skill path must be absolute: ${override.path}`);
    result.set(`path:${path}`, {
      ...(result.get(`path:${path}`) ?? { path }),
      enabled: override.state === "enabled",
    });
  }
  return canonicalize([...result.values()]);
}

export class ProfileService {
  constructor(readonly client: AppServerClient, readonly store: JsonStore) {}

  async listProfiles(): Promise<SkillProfile[]> {
    return (await this.store.readProfiles()).profiles;
  }

  async saveProfile(input: { id?: string; name: string; overrides: SkillOverride[] }): Promise<SkillProfile> {
    return this.store.withLock(async () => {
      const file = await this.store.readProfiles();
      const now = new Date().toISOString();
      const existing = input.id ? file.profiles.find((item) => item.id === input.id) : undefined;
      const profile = skillProfileSchema.parse({
        id: input.id ?? randomUUID(),
        name: input.name,
        overrides: input.overrides,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      file.profiles = [...file.profiles.filter((item) => item.id !== profile.id), profile];
      if (file.activeProfileId === profile.id) file.activeProfileId = null;
      await this.store.writeProfiles(file);
      await this.syncProjectBindings(file, profile.id);
      return profile;
    });
  }

  async deleteProfile(id: string): Promise<void> {
    await this.store.withLock(async () => {
      const file = await this.store.readProfiles();
      file.profiles = file.profiles.filter((profile) => profile.id !== id);
      if (file.activeProfileId === id) file.activeProfileId = null;
      await this.store.writeProfiles(file);
      const bindings = await this.store.readProjectBindings();
      bindings.bindings = bindings.bindings.filter((binding) => binding.profileId !== id);
      await this.store.writeProjectBindings(bindings);
    });
  }

  async importProfiles(incoming: ProfilesFile, mode: "merge" | "replace"): Promise<ProfilesFile> {
    return this.store.withLock(async () => {
      const current = await this.store.readProfiles();
      const next: ProfilesFile = {
        schemaVersion: 1,
        profiles: mode === "replace"
          ? incoming.profiles
          : [
              ...current.profiles.filter(
                (a) => !incoming.profiles.some((b) => a.id === b.id),
              ),
              ...incoming.profiles,
            ],
      };
      await this.store.writeProfiles(next);
      await this.syncProjectBindings(next);
      return next;
    });
  }

  async saveGlobalDefaults(cwd: string, value: SkillConfigEntry[]): Promise<void> {
    await this.requireBatchWrite();
    await this.store.withLock(async () => {
      const inventory = await this.client.listSkills([cwd], true);
      const layer = extractUserSkillLayer(await this.client.readConfig(cwd));
      const allowed = new Set(canonicalize([
        ...inventory.data.flatMap((item) => item.skills.map((skill) => ({
          path: skill.path, enabled: skill.enabled,
        }))),
        ...layer.value,
      ]).flatMap((entry) => entry.path === undefined ? [] : [entry.path]));
      const normalized = canonicalize([
        ...layer.value.filter((entry) => entry.path === undefined),
        ...value,
      ]);
      if (normalized.some((entry) => entry.path !== undefined && !allowed.has(entry.path))) {
        throw new Error("unknown skill path");
      }
      await this.client.batchWriteSkillsConfig(normalized, layer.version);
      const file = await this.store.readProfiles();
      file.activeProfileId = null;
      await this.store.writeProfiles(file);
    });
  }

  async applyPersistent(
    cwd: string,
    overrides: SkillOverride[],
    profileId: string | null,
  ): Promise<SkillConfigEntry[]> {
    await this.requireBatchWrite();
    return this.store.withLock(async () => {
      const inventory = await this.client.listSkills([cwd], true);
      const layer = extractUserSkillLayer(await this.client.readConfig(cwd));
      const allowed = new Set(canonicalize([
        ...inventory.data.flatMap((item) => item.skills.map((skill) => ({
          path: skill.path, enabled: skill.enabled,
        }))),
        ...layer.value,
      ]).flatMap((entry) => entry.path === undefined ? [] : [entry.path]));
      if (overrides.some((override) => !allowed.has(canonicalize([
        { path: override.path, enabled: true },
      ])[0].path!))) {
        throw new Error("unknown skill path");
      }
      const target = resolveTarget(layer.value, overrides);
      await this.client.batchWriteSkillsConfig(target, layer.version);
      const file = await this.store.readProfiles();
      file.activeProfileId = profileId;
      await this.store.writeProfiles(file);
      await this.store.appendAudit({ action: "applied", cwd });
      return target;
    });
  }

  async saveProjectConfiguration(
    cwd: string,
    overrides: SkillOverride[],
    compatibilityMode = true,
    profileId: string | null = null,
  ): Promise<SkillConfigEntry[]> {
    return this.store.withLock(async () => {
      const profile = profileId === null
        ? undefined
        : (await this.store.readProfiles()).profiles.find((item) => item.id === profileId);
      if (profileId !== null && profile === undefined) throw new Error("unknown skill profile");
      const value = await this.writeProjectConfiguration(
        cwd,
        profile?.overrides ?? overrides,
        compatibilityMode,
        profile !== undefined,
      );
      const bindings = await this.store.readProjectBindings();
      const normalizedCwd = normalize(cwd);
      bindings.bindings = [
        ...bindings.bindings.filter((binding) => normalize(binding.cwd) !== normalizedCwd),
        ...(profileId === null ? [] : [{ cwd: normalizedCwd, profileId, compatibilityMode }]),
      ];
      await this.store.writeProjectBindings(bindings);
      await this.store.appendAudit({ action: "project-config-saved", cwd });
      return value;
    });
  }

  private async syncProjectBindings(file: ProfilesFile, profileId?: string): Promise<void> {
    const bindings = await this.store.readProjectBindings();
    const profiles = new Map(file.profiles.map((profile) => [profile.id, profile]));
    const active = bindings.bindings.filter((binding) => profiles.has(binding.profileId));
    if (active.length !== bindings.bindings.length) {
      await this.store.writeProjectBindings({ schemaVersion: 1, bindings: active });
    }
    await Promise.all(active
      .filter((binding) => profileId === undefined || binding.profileId === profileId)
      .map((binding) => this.writeProjectConfiguration(
        binding.cwd,
        profiles.get(binding.profileId)!.overrides,
        binding.compatibilityMode,
        true,
      )));
  }

  private async writeProjectConfiguration(
    cwd: string,
    overrides: SkillOverride[],
    compatibilityMode: boolean,
    ignoreUnknown = false,
  ): Promise<SkillConfigEntry[]> {
    const [inventory, layer] = await Promise.all([
      this.client.listSkills([cwd], true),
      compatibilityMode
        ? readProjectSkillPolicy(this.client, cwd)
        : this.client.readConfig(cwd).then((config) => extractProjectSkillLayer(config, cwd)),
    ]);
    const allowed = new Set(canonicalize([
      ...inventory.data.flatMap((item) => item.skills.map((skill) => ({
        path: skill.path, enabled: skill.enabled,
      }))),
      ...layer.value,
    ]).flatMap((entry) => entry.path === undefined ? [] : [entry.path]));
    const knownOverrides = overrides.filter((override) => allowed.has(canonicalize([
      { path: override.path, enabled: true },
    ])[0].path!));
    if (!ignoreUnknown && knownOverrides.length !== overrides.length) {
      throw new Error("unknown skill path");
    }
    const value = canonicalize([
      ...layer.value.filter((entry) => entry.path === undefined),
      ...knownOverrides.map(({ path, state }) => ({
        path,
        enabled: state === "enabled",
      })),
    ]);
    const names = new Map(inventory.data.flatMap((item) =>
      item.skills.map((skill) => [canonicalize([{ path: skill.path, enabled: true }])[0].path!, skill.name] as const)));
    if (compatibilityMode) {
      const source = "source" in layer ? layer.source : "";
      await this.client.writeFile(layer.filePath, replaceProjectSkillPolicy(source, value, names));
    } else {
      const directory = dirname(layer.filePath);
      await this.client.createDirectory(directory);
      const entries = await this.client.readDirectory(directory);
      const source = entries.some((entry) =>
        entry.fileName === basename(layer.filePath) && entry.isFile)
        ? await this.client.readFile(layer.filePath)
        : "";
      await this.client.writeFile(layer.filePath, replaceProjectSkillConfig(source, value));
    }
    return value;
  }

  private async requireBatchWrite(): Promise<void> {
    if (!(await this.client.canBatchWrite())) {
      throw new Error("config/batchWrite is unavailable; skill configuration is read-only");
    }
  }
}
