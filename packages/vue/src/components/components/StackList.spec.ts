import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import type { GroupedEntry } from "@notifications/shared";
import StackList from "./StackList.vue";
import { feedItem } from "../../test-support/feedItem";

const entry = (over: Partial<GroupedEntry> & { id: string }): GroupedEntry => ({
  ...feedItem(over),
  groupKey: undefined,
  groupLabel: over.id,
  groupTotal: 1,
  topPriority: "normal",
  ...over,
});

// Stub the row so we only assert which section each entry lands in.
const StackRowStub = { props: ["entry"], template: `<div class="row" :data-id="entry.id" />` };

function mountList(entries: GroupedEntry[], stuck = new Set<string>()) {
  return mount(StackList, {
    props: {
      entries,
      unread: 0,
      hasMore: false,
      loadingMore: false,
      transport: { get: vi.fn() },
      stuck,
    },
    global: { stubs: { StackRow: StackRowStub } },
  });
}

describe("StackList partition", () => {
  it("puts unread entries in Needs action and read entries in Earlier", () => {
    const w = mountList([entry({ id: "u1", read: false }), entry({ id: "r1", read: true })]);
    // First <section> is Needs action.
    expect(w.get("section").find('[data-id="u1"]').exists()).toBe(true);
    expect(w.get('[data-test="earlier-list"]').find('[data-id="r1"]').exists()).toBe(true);
  });

  it("keeps a stuck read entry in Needs action, not Earlier", () => {
    const w = mountList([entry({ id: "s1", read: true })], new Set(["s1"]));
    // s1 is read but stuck → held in Needs action; no Earlier section at all.
    expect(w.find('[data-test="earlier-list"]').exists()).toBe(false);
    expect(w.get("section").find('[data-id="s1"]').exists()).toBe(true);
  });

  it("moves a formerly-stuck entry to Earlier once it is no longer stuck", () => {
    const w = mountList([entry({ id: "s1", read: true })], new Set());
    expect(w.get('[data-test="earlier-list"]').find('[data-id="s1"]').exists()).toBe(true);
  });

  it("renders BOTH entries of a split subject in Needs action (same groupKey, distinct ids)", () => {
    // A subject's read member, marked unread this session, becomes a second unread entry that shares
    // the unread stack's groupKey. Keyed by id (not groupKey) both must render — no v-for key collision.
    const w = mountList([
      entry({ id: "unread-rep", read: false, groupKey: "dsr:#9", groupTotal: 3 }),
      entry({ id: "was-read", read: false, groupKey: "dsr:#9", groupTotal: 1 }),
    ]);
    const needs = w.get("section");
    expect(needs.find('[data-id="unread-rep"]').exists()).toBe(true);
    expect(needs.find('[data-id="was-read"]').exists()).toBe(true);
  });
});
