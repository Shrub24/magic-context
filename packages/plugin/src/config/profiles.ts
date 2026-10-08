import { ConfigProfilesSchema } from "./schema/magic-context";

/**
 * Environment variable a launcher uses to select a config profile for the
 * process it spawns. Read by the Pi/OMP loader only (see `loadPiConfigDetailed`).
 */
export const LAUNCHER_PROFILE_ENV = "MAGIC_CONTEXT_PROFILE";

export interface ProfileResolution {
    /** User config minus the profile declarations and selector. */
    userBase: Record<string, unknown>;
    /** Project config minus the profile declarations and selector. */
    projectBase: Record<string, unknown>;
    /** The validated user-owned overlay for the active profile, if any. */
    overlay: Record<string, unknown>;
    /**
     * Overlay for the launcher-selected profile (`LAUNCHER_PROFILE_ENV`).
     * Callers merge this AFTER `projectBase`, so a project config cannot weaken
     * a launcher-selected policy.
     */
    launcherOverlay?: Record<string, unknown>;
    /** The selected profile name, absent when no valid profile is active. */
    activeProfile?: string;
    warnings: string[];
}

interface ProfileSelection {
    declared: boolean;
    name?: string;
}

function withoutProfileFields(raw: Record<string, unknown>): Record<string, unknown> {
    const copy = { ...raw };
    delete copy.profile;
    delete copy.profiles;
    return copy;
}

function readProfileSelection(raw: Record<string, unknown>): ProfileSelection {
    if (!Object.hasOwn(raw, "profile")) return { declared: false };
    const value = raw.profile;
    if (typeof value !== "string") return { declared: true };
    const name = value.trim();
    return name.length > 0 ? { declared: true, name } : { declared: true };
}

/**
 * Resolve the user-owned profile overlay without retaining any process-global
 * selection state. Callers merge `userBase`, `overlay`, then `projectBase` for
 * every project load, so a Pi /cd or OpenCode multi-root session cannot borrow
 * another repository's selected profile.
 */
export function resolveConfigProfile(args: {
    userRaw: Record<string, unknown>;
    projectRaw: Record<string, unknown>;
    /**
     * Profile named by the launcher (`LAUNCHER_PROFILE_ENV`). Returned as
     * `launcherOverlay` for the caller to merge last; an unknown name warns and
     * leaves normal resolution untouched rather than refusing the session.
     */
    launcherProfile?: string;
}): ProfileResolution {
    const warnings: string[] = [];
    const userSelection = readProfileSelection(args.userRaw);
    const projectSelection = readProfileSelection(args.projectRaw);
    const selection = projectSelection.name
        ? { name: projectSelection.name, source: "project" }
        : userSelection.name
          ? { name: userSelection.name, source: "user" }
          : undefined;

    if (projectSelection.declared && !projectSelection.name) {
        warnings.push(
            "Ignoring invalid profile selection from project config; expected a non-empty string.",
        );
    }
    if (!projectSelection.declared && userSelection.declared && !userSelection.name) {
        warnings.push(
            "Ignoring invalid profile selection from user config; expected a non-empty string.",
        );
    }

    let profiles: Record<string, Record<string, unknown>> = {};
    if (Object.hasOwn(args.userRaw, "profiles")) {
        const parsed = ConfigProfilesSchema.safeParse(args.userRaw.profiles);
        if (parsed.success) {
            profiles = parsed.data as Record<string, Record<string, unknown>>;
        } else {
            warnings.push(
                "Ignoring profiles from user config: invalid profile configuration; profiles may contain only historian/dreamer harness model blocks and memory.read_only.",
            );
        }
    }

    let launcherOverlay: Record<string, unknown> | undefined;
    if (args.launcherProfile) {
        if (Object.hasOwn(profiles, args.launcherProfile)) {
            launcherOverlay = profiles[args.launcherProfile];
        } else {
            const known = Object.keys(profiles).sort();
            warnings.push(
                `Unknown ${LAUNCHER_PROFILE_ENV} profile "${args.launcherProfile}"; using normal profile resolution. Known profiles: ${
                    known.length > 0 ? known.join(", ") : "(none defined in user config)"
                }.`,
            );
        }
    }
    const base = {
        userBase: withoutProfileFields(args.userRaw),
        projectBase: withoutProfileFields(args.projectRaw),
        launcherOverlay,
        warnings,
    };
    // The launcher profile is the policy actually in effect, so it owns the
    // profile identity when it applies.
    const launcherName = launcherOverlay ? args.launcherProfile : undefined;

    if (!selection) {
        return {
            ...base,
            overlay: {},
            activeProfile: launcherName,
        };
    }

    if (!Object.hasOwn(profiles, selection.name)) {
        warnings.push(
            `Unknown profile "${selection.name}" selected by ${selection.source} config; using base config without a profile.`,
        );
        return {
            ...base,
            overlay: {},
            activeProfile: launcherName,
        };
    }

    const overlay = profiles[selection.name];
    return {
        ...base,
        overlay,
        activeProfile: launcherName ?? selection.name,
    };
}
