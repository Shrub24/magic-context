import { describe, expect, it } from "bun:test";
import { resolveProjectIdentity } from "@magic-context/core/features/magic-context/memory/project-identity";
import {
	getMemoriesByProject,
	insertMemory,
} from "@magic-context/core/features/magic-context/memory/storage-memory";
import { getNotes } from "@magic-context/core/features/magic-context/storage";
import {
	A1_HASH_BASELINE_HEADING,
	A1_TOOL_SECTION_HEADING,
	a1GoldenSectionOffset,
	readA1GoldenDocument,
} from "@magic-context/core/shared/prompt-surface-a1-golden";
import {
	createPromptSurfaceRuntime,
	LIGHT_TOOL_DESCRIPTIONS,
} from "@magic-context/core/shared/prompt-surface-runtime";
import { closeQuietly } from "@magic-context/core/shared/sqlite-helpers";
import {
	FULL_PARAMETER_DESCRIPTIONS,
	LIGHT_PARAMETER_DESCRIPTIONS,
} from "@magic-context/core/tools/parameter-descriptions";
import { __setPiHarnessKindForTesting } from "../pi-harness-kind";
import { createTestDb, fakeContext } from "../test-utils.test";
import {
	registerMagicContextTools,
	syncMemoryWriteToolsEnabled,
} from "./index";

interface RefusableTool {
	name: string;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal,
		onUpdate: undefined,
		ctx: unknown,
	) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }>;
}

function captureTools() {
	const registered = new Map<string, RefusableTool>();
	const pi = {
		registerTool: (tool: RefusableTool) => registered.set(tool.name, tool),
	} as never;
	return { registered, pi };
}

describe("registerMagicContextTools", () => {
	it("withholds the write tools each policy forbids and restores them after a config reload", () => {
		const baseline = [
			"read",
			"ctx_search",
			"ctx_memory",
			"ctx_note",
			"ctx_expand",
			"ctx_reduce",
		];
		let activeTools: string[] = [];
		const pi = {
			getActiveTools: () => activeTools,
			setActiveTools: (tools: string[]) => {
				activeTools = tools;
			},
		} as never;
		// Each policy is asserted from a fresh session's enabled set; the read
		// surface (`ctx_search`/`ctx_expand`/`ctx_reduce`) is never touched.
		const activeAfter = (gates: { memories: boolean; notes: boolean }) => {
			activeTools = [...baseline];
			syncMemoryWriteToolsEnabled(pi, gates);
			return [...activeTools].sort();
		};

		// `memory.read_only`: both tools that write project knowledge go.
		expect(activeAfter({ memories: false, notes: false })).toEqual(
			["ctx_expand", "ctx_reduce", "ctx_search", "read"].sort(),
		);
		// `memory.enabled: false` withholds ctx_memory alone — ctx_note keeps the
		// scope it has on OpenCode.
		expect(activeAfter({ memories: false, notes: true })).toEqual(
			["ctx_expand", "ctx_note", "ctx_reduce", "ctx_search", "read"].sort(),
		);
		// A later session in the same process restores both from the plain set.
		expect(activeAfter({ memories: true, notes: true })).toEqual(
			[...baseline].sort(),
		);
	});

	it("refuses a direct ctx_memory/ctx_note call in a read-only session and writes nothing", async () => {
		const db = createTestDb();
		try {
			const { registered, pi } = captureTools();

			registerMagicContextTools(pi, {
				db,
				// The definitions stay registered; the resolver decides the policy.
				memoryToolEnabled: true,
				memoryEnabled: true,
				embeddingEnabled: false,
				gitCommitsEnabled: false,
				resolveMemoryWritesEnabled: () => false,
				resolveNotesWritesEnabled: () => false,
			});

			const ctx = fakeContext("ses-read-only");
			// The registry's surface wrapper turns a returned refusal into a thrown
			// tool error, which is what Pi shows the agent.
			await expect(
				registered.get("ctx_memory")?.execute(
					"call-memory",
					{
						action: "write",
						content: "must not be written",
						category: "pattern",
					},
					new AbortController().signal,
					undefined,
					ctx,
				),
			).rejects.toThrow(
				/ctx_memory is unavailable while memory writes are disabled for this session/,
			);
			await expect(
				registered
					.get("ctx_note")
					?.execute(
						"call-note",
						{ action: "write", content: "must not be written" },
						new AbortController().signal,
						undefined,
						ctx,
					),
			).rejects.toThrow(
				/ctx_note is unavailable while memory\.read_only is set for this session/,
			);

			expect(getNotes(db, { sessionId: "ses-read-only" })).toEqual([]);
			expect(
				getMemoriesByProject(db, resolveProjectIdentity(process.cwd())),
			).toEqual([]);

			// The read surface is untouched: the same session finds a project memory.
			insertMemory(db, {
				projectPath: resolveProjectIdentity(process.cwd()),
				category: "NAMING",
				content: "a read-only session can still read this fact",
			});
			const found = await registered
				.get("ctx_search")
				?.execute(
					"call-search",
					{ query: "read this fact", sources: ["memory"] },
					new AbortController().signal,
					undefined,
					ctx,
				);
			expect(found?.isError).toBeUndefined();
			expect(found?.content[0]?.text).toContain(
				"a read-only session can still read this fact",
			);
		} finally {
			closeQuietly(db);
		}
	});

	it("keeps ctx_note working when memory is off, refusing ctx_memory alone", async () => {
		const db = createTestDb();
		try {
			const { registered, pi } = captureTools();

			// `memory.enabled: false` with a writable session: the memory feature switch
			// keeps its existing scope, which is ctx_memory only.
			registerMagicContextTools(pi, {
				db,
				memoryToolEnabled: true,
				memoryEnabled: false,
				embeddingEnabled: false,
				gitCommitsEnabled: false,
				resolveMemoryWritesEnabled: () => false,
				resolveNotesWritesEnabled: () => true,
			});

			const ctx = fakeContext("ses-memory-off");
			await expect(
				registered.get("ctx_memory")?.execute(
					"call-memory",
					{
						action: "write",
						content: "must not be written",
						category: "NAMING",
					},
					new AbortController().signal,
					undefined,
					ctx,
				),
			).rejects.toThrow(
				/ctx_memory is unavailable while memory writes are disabled for this session \(memory\.enabled: false or memory\.read_only\)/,
			);

			const note = await registered
				.get("ctx_note")
				?.execute(
					"call-note",
					{ action: "write", content: "a note survives memory being off" },
					new AbortController().signal,
					undefined,
					ctx,
				);
			expect(note?.isError).toBeUndefined();
			expect(
				getNotes(db, { sessionId: "ses-memory-off", type: "session" }).map(
					(n) => n.content,
				),
			).toEqual(["a note survives memory being off"]);
		} finally {
			closeQuietly(db);
		}
	});

	it("can omit ctx_memory for lean child processes", () => {
		const db = createTestDb();
		try {
			const registered: string[] = [];
			const commands: string[] = [];
			const pi = {
				registerTool: (tool: { name: string }) => {
					registered.push(tool.name);
				},
				registerCommand: (name: string) => {
					commands.push(name);
				},
			} as never;

			registerMagicContextTools(pi, {
				db,
				todowriteEnabled: true,
				memoryToolEnabled: false,
				sessionScopedToolsDisabled: true,
				todowriteCommandEnabled: false,
			});

			expect(registered).toContain("ctx_search");
			expect(registered).not.toContain("ctx_memory");
			expect(registered).not.toContain("ctx_note");
			expect(registered).not.toContain("ctx_expand");
			expect(registered).toContain("todowrite");
			expect(commands).not.toContain("todos");
		} finally {
			closeQuietly(db);
		}
	});

	it("removes only ctx_reduce in compaction-off mode", () => {
		const db = createTestDb();
		try {
			const registered: string[] = [];
			const pi = {
				registerTool: (tool: { name: string }) => registered.push(tool.name),
				registerCommand: () => undefined,
			} as never;
			registerMagicContextTools(pi, {
				db,
				compactionOff: true,
				todowriteEnabled: true,
			});

			expect(registered).not.toContain("ctx_reduce");
			expect(registered).toEqual(
				expect.arrayContaining([
					"ctx_search",
					"ctx_memory",
					"ctx_note",
					"ctx_expand",
					"todowrite",
				]),
			);
		} finally {
			closeQuietly(db);
		}
	});

	it("marks every ctx_* tool essential only for OMP", () => {
		const db = createTestDb();
		const registerFor = (kind: "pi" | "omp") => {
			__setPiHarnessKindForTesting(kind);
			const registered = new Map<string, { name: string; loadMode?: string }>();
			const pi = {
				registerTool: (tool: { name: string; loadMode?: string }) =>
					registered.set(tool.name, tool),
				registerCommand: () => undefined,
			} as never;
			registerMagicContextTools(pi, { db, allowDreamerActions: true });
			return [...registered.values()].filter((tool) =>
				tool.name.startsWith("ctx_"),
			);
		};

		try {
			const expectedNames = [
				"ctx_expand",
				"ctx_memory",
				"ctx_memory_list",
				"ctx_note",
				"ctx_reduce",
				"ctx_search",
			];
			const ompTools = registerFor("omp");
			expect(ompTools.map((tool) => tool.name).sort()).toEqual(expectedNames);
			for (const tool of ompTools) expect(tool.loadMode).toBe("essential");

			const piTools = registerFor("pi");
			expect(piTools.map((tool) => tool.name).sort()).toEqual(expectedNames);
			for (const tool of piTools) expect(tool).not.toHaveProperty("loadMode");
		} finally {
			__setPiHarnessKindForTesting(undefined);
			closeQuietly(db);
		}
	});

	it("advertises only real ctx_* fields and allows additional properties", () => {
		const db = createTestDb();
		try {
			const registered = new Map<
				string,
				{
					name: string;
					parameters: {
						properties?: Record<string, unknown>;
						additionalProperties?: unknown;
					};
				}
			>();
			const pi = {
				registerTool: (tool: {
					name: string;
					parameters: {
						properties?: Record<string, unknown>;
						additionalProperties?: unknown;
					};
				}) => registered.set(tool.name, tool),
				registerCommand: () => undefined,
			} as never;

			registerMagicContextTools(pi, { db });
			expect(registered.has("ctx_memory_list")).toBe(false);

			const expectedFields: Record<string, string[]> = {
				ctx_search: ["query", "limit", "from", "to", "sources"],
				// No `limit`: it only sized the dreamer-only list action, which now
				// lives on ctx_memory_list (issue 575).
				ctx_memory: ["action", "content", "category", "ids", "reason"],
				ctx_note: [
					"action",
					"content",
					"surface_condition",
					"note_ids",
					"filter",
					"limit",
					"offset",
				],
				ctx_expand: ["start", "end", "verbose", "message", "tag"],
				ctx_reduce: ["drop"],
			};
			for (const [name, fields] of Object.entries(expectedFields)) {
				const definition = registered.get(name);
				expect(definition).toBeDefined();
				expect(
					Object.keys(definition?.parameters.properties ?? {}).sort(),
				).toEqual([...fields].sort());
				expect(definition?.parameters.properties).not.toHaveProperty("reduced");
				expect(definition?.parameters.properties).not.toHaveProperty("summary");
				expect(definition?.parameters.additionalProperties).toBe(true);
			}
		} finally {
			closeQuietly(db);
		}
	});

	it("registers ctx_memory_list only for dreamer child surfaces", () => {
		const db = createTestDb();
		try {
			const registered = new Map<
				string,
				{ parameters: { properties?: Record<string, unknown> } }
			>();
			const pi = {
				registerTool: (tool: {
					name: string;
					parameters: { properties?: Record<string, unknown> };
				}) => registered.set(tool.name, tool),
				registerCommand: () => undefined,
			} as never;
			registerMagicContextTools(pi, { db, allowDreamerActions: true });
			expect(registered.has("ctx_memory_list")).toBe(true);
			expect(
				Object.keys(
					registered.get("ctx_memory_list")?.parameters.properties ?? {},
				).sort(),
			).toEqual(["category", "limit"]);
		} finally {
			closeQuietly(db);
		}
	});

	it("registered tools resolve smart-note gating from the invocation cwd", async () => {
		const db = createTestDb();
		try {
			const registered = new Map<
				string,
				{ execute: (...args: never[]) => unknown }
			>();
			const pi = {
				registerTool: (tool: {
					name: string;
					execute: (...args: never[]) => unknown;
				}) => {
					registered.set(tool.name, tool);
				},
				registerCommand: () => undefined,
			} as never;

			registerMagicContextTools(pi, {
				db,
				dreamerEnabled: false,
				resolveDreamerEnabled: (ctx) => ctx.cwd === "/tmp/project-b",
			});

			const noteTool = registered.get("ctx_note");
			expect(noteTool).toBeDefined();
			const result = await noteTool?.execute(
				"call-1" as never,
				{
					action: "write",
					content: "Project B smart note",
					surface_condition: "When project B condition is true",
				} as never,
				new AbortController().signal as never,
				undefined as never,
				{
					cwd: "/tmp/project-b",
					sessionManager: { getSessionId: () => "ses-tool-cd" },
				} as never,
			);

			expect(
				(result as { isError?: boolean } | undefined)?.isError,
			).toBeUndefined();
		} finally {
			closeQuietly(db);
		}
	});

	it("registers todowrite and /todos when explicitly enabled", () => {
		const db = createTestDb();
		try {
			const registered: string[] = [];
			const commands: string[] = [];
			const pi = {
				registerTool: (tool: { name: string }) => registered.push(tool.name),
				registerCommand: (name: string) => commands.push(name),
			} as never;

			registerMagicContextTools(pi, { db, todowriteEnabled: true });

			expect(registered).toContain("todowrite");
			expect(commands).toContain("todos");
		} finally {
			closeQuietly(db);
		}
	});

	it.each([
		undefined,
		false,
	])("omits todowrite and /todos when enabled is %s", (todowriteEnabled) => {
		const db = createTestDb();
		try {
			const registered: string[] = [];
			const commands: string[] = [];
			const pi = {
				registerTool: (tool: { name: string }) => registered.push(tool.name),
				registerCommand: (name: string) => commands.push(name),
			} as never;

			registerMagicContextTools(pi, { db, todowriteEnabled });

			expect(registered).toContain("ctx_search");
			expect(registered).not.toContain("todowrite");
			expect(commands).not.toContain("todos");
		} finally {
			closeQuietly(db);
		}
	});

	it("can keep /todos off for lean subagent entries", () => {
		const db = createTestDb();
		try {
			const registered: string[] = [];
			const commands: string[] = [];
			const pi = {
				registerTool: (tool: { name: string }) => registered.push(tool.name),
				registerCommand: (name: string) => commands.push(name),
			} as never;

			registerMagicContextTools(pi, {
				db,
				todowriteEnabled: true,
				todowriteCommandEnabled: false,
			});

			expect(registered).toContain("todowrite");
			expect(commands).not.toContain("todos");
		} finally {
			closeQuietly(db);
		}
	});
});

function withoutDescriptions(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutDescriptions);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => key !== "description")
			.map(([key, child]) => [key, withoutDescriptions(child)]),
	);
}

type RegisteredPromptTool = {
	name: string;
	description: string;
	parameters: { properties?: Record<string, unknown> };
};

function readA1GoldenTools(): Record<
	string,
	{ description: string; parameters: Record<string, unknown> }
> {
	const document = readA1GoldenDocument();
	const toolSection = document.slice(
		a1GoldenSectionOffset(document, A1_TOOL_SECTION_HEADING),
		a1GoldenSectionOffset(document, A1_HASH_BASELINE_HEADING),
	);
	const headings = [...toolSection.matchAll(/^### (ctx_[a-z_]+) —.*$/gm)];
	return Object.fromEntries(
		headings.map((heading, index) => {
			const start = (heading.index ?? 0) + heading[0].length;
			const end = headings[index + 1]?.index ?? toolSection.length;
			const body = toolSection.slice(start, end);
			const description = body.match(
				/\*\*Description:\*\*\s+```\n([\s\S]*?)\n```/,
			)?.[1];
			const parameters = body.match(
				/\*\*Parameters \(JSON Schema per parameter, as serialized to the provider\):\*\*\s+```json\n([\s\S]*?)\n```/,
			)?.[1];
			if (description === undefined || parameters === undefined) {
				throw new Error(`Malformed A1 golden tool section: ${heading[1]}`);
			}
			return [
				heading[1],
				{
					description,
					parameters: JSON.parse(parameters) as Record<string, unknown>,
				},
			];
		}),
	);
}

function captureRegisteredTools(
	options: Parameters<typeof registerMagicContextTools>[1],
): Map<string, RegisteredPromptTool> {
	const registered = new Map<string, RegisteredPromptTool>();
	const pi = {
		registerTool: (tool: RegisteredPromptTool) =>
			registered.set(tool.name, tool),
		registerCommand: () => undefined,
	} as never;
	registerMagicContextTools(pi, options);
	return registered;
}

describe("registerMagicContextTools — prompt-surface registration", () => {
	it("matches the A1 golden for no config and explicit full", () => {
		const golden = readA1GoldenTools();
		const implicitDb = createTestDb();
		const explicitDb = createTestDb();
		try {
			const implicit = captureRegisteredTools({ db: implicitDb });
			const explicit = captureRegisteredTools({
				db: explicitDb,
				promptSurface: { default: "full" },
			});
			const implicitIds = [...implicit.keys()].filter((id) =>
				id.startsWith("ctx_"),
			);
			const explicitIds = [...explicit.keys()].filter((id) =>
				id.startsWith("ctx_"),
			);

			expect(implicitIds.sort()).toEqual(Object.keys(golden).sort());
			expect(explicitIds.sort()).toEqual(Object.keys(golden).sort());
			for (const [toolId, expected] of Object.entries(golden)) {
				expect(implicit.get(toolId)?.description).toBe(expected.description);
				expect(explicit.get(toolId)?.description).toBe(expected.description);
				expect(explicit.get(toolId)?.parameters).toEqual(
					implicit.get(toolId)?.parameters,
				);
				// Pi uses TypeBox rather than OpenCode's Zod adapter, so its
				// parameter object has host metadata. The A1 contract here is that
				// IDs stay aligned and prompt-surface selection leaves those
				// Pi-owned bytes unchanged.
				expect(
					Object.keys(implicit.get(toolId)?.parameters.properties ?? {}).sort(),
				).toEqual(Object.keys(expected.parameters).sort());
			}
		} finally {
			closeQuietly(implicitDb);
			closeQuietly(explicitDb);
		}
	});

	it("registers built-in light prose without changing non-description schema fields", () => {
		const fullDb = createTestDb();
		const lightDb = createTestDb();
		try {
			const full = captureRegisteredTools({ db: fullDb });
			const light = captureRegisteredTools({
				db: lightDb,
				promptSurface: { default: "light" },
			});
			for (const toolId of Object.keys(LIGHT_TOOL_DESCRIPTIONS)) {
				expect(light.get(toolId)?.description).toBe(
					LIGHT_TOOL_DESCRIPTIONS[
						toolId as keyof typeof LIGHT_TOOL_DESCRIPTIONS
					],
				);
				expect(light.get(toolId)?.parameters).not.toEqual(
					full.get(toolId)?.parameters,
				);
				const lightParameters = light.get(toolId)?.parameters;
				const fullParameters = full.get(toolId)?.parameters;
				expect(withoutDescriptions(lightParameters)).toEqual(
					withoutDescriptions(fullParameters),
				);
				for (const [name, description] of Object.entries(
					LIGHT_PARAMETER_DESCRIPTIONS[
						toolId as keyof typeof LIGHT_PARAMETER_DESCRIPTIONS
					],
				)) {
					expect(
						(lightParameters?.properties?.[name] as { description?: string })
							?.description,
					).toBe(description);
					expect(
						(fullParameters?.properties?.[name] as { description?: string })
							?.description,
					).toBe(
						(
							FULL_PARAMETER_DESCRIPTIONS as Record<
								string,
								Record<string, string>
							>
						)[toolId]?.[name],
					);
				}
			}
		} finally {
			closeQuietly(fullDb);
			closeQuietly(lightDb);
		}
	});

	it("applies top-level overrides once without changing parameter schemas", () => {
		const baselineDb = createTestDb();
		const overrideDb = createTestDb();
		const warnings: string[] = [];
		try {
			const baseline = captureRegisteredTools({ db: baselineDb });
			const runtime = createPromptSurfaceRuntime({
				userConfigDirectory: process.cwd(),
				warn: (warning) => warnings.push(warning),
			});
			const overridden = captureRegisteredTools({
				db: overrideDb,
				promptSurface: {
					default: "full",
					models: { "provider/model": "light" },
					tool_descriptions: { ctx_search: "Pi custom search surface" },
				},
				promptSurfaceRuntime: runtime,
			});

			expect(overridden.get("ctx_search")?.description).toBe(
				"Pi custom search surface",
			);
			expect(overridden.get("ctx_reduce")?.description).toBe(
				baseline.get("ctx_reduce")?.description,
			);
			for (const toolId of [...baseline.keys()].filter((id) =>
				id.startsWith("ctx_"),
			)) {
				expect(overridden.get(toolId)?.parameters).toEqual(
					baseline.get(toolId)?.parameters,
				);
			}
			expect(warnings).toEqual([]);
		} finally {
			closeQuietly(baselineDb);
			closeQuietly(overrideDb);
		}
	});
});
