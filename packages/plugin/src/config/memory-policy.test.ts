import { describe, expect, it } from "bun:test";
import { memoryPromotionEnabled, memoryWritesEnabled, notesWritesEnabled } from "./memory-policy";

describe("memoryWritesEnabled", () => {
    it("withholds writes for every enabled/read_only combination", () => {
        expect(memoryWritesEnabled({ enabled: true, read_only: false })).toBe(true);
        expect(memoryWritesEnabled({ enabled: true, read_only: true })).toBe(false);
        expect(memoryWritesEnabled({ enabled: false, read_only: false })).toBe(false);
        expect(memoryWritesEnabled({ enabled: false, read_only: true })).toBe(false);
    });

    it("treats an absent key as its schema default", () => {
        expect(memoryWritesEnabled({})).toBe(true);
        expect(memoryWritesEnabled({ read_only: true })).toBe(false);
        expect(memoryWritesEnabled({ enabled: false })).toBe(false);
    });
});

describe("notesWritesEnabled", () => {
    it("follows read_only alone, so memory.enabled: false keeps notes working", () => {
        expect(notesWritesEnabled({ enabled: true, read_only: false })).toBe(true);
        expect(notesWritesEnabled({ enabled: false, read_only: false })).toBe(true);
        expect(notesWritesEnabled({ enabled: true, read_only: true })).toBe(false);
        expect(notesWritesEnabled({ enabled: false, read_only: true })).toBe(false);
        expect(notesWritesEnabled({})).toBe(true);
    });
});

describe("memoryPromotionEnabled", () => {
    it("requires write access and auto_promote together", () => {
        expect(
            memoryPromotionEnabled({ enabled: true, read_only: false, auto_promote: true }),
        ).toBe(true);
        expect(memoryPromotionEnabled({ enabled: true, read_only: true, auto_promote: true })).toBe(
            false,
        );
        expect(
            memoryPromotionEnabled({ enabled: true, read_only: false, auto_promote: false }),
        ).toBe(false);
        expect(
            memoryPromotionEnabled({ enabled: false, read_only: false, auto_promote: true }),
        ).toBe(false);
    });
});
