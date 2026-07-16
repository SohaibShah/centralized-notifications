import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import type { FeedGroup } from "@/stores/feed";
import FeedList from "./FeedList.vue";
import { feedItem } from "@/test-support/feedItem";

const groups: FeedGroup[] = [
  {
    key: "needs-action",
    label: "Needs action",
    items: [feedItem({ id: "u1" }), feedItem({ id: "u2" })],
  },
  {
    key: "earlier",
    label: "Earlier",
    items: [feedItem({ id: "r1", read: true }), feedItem({ id: "r2", read: true })],
  },
];

describe("FeedList", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows a Mark all read control on the needs-action header and emits markAll", async () => {
    const wrapper = mount(FeedList, { props: { groups, hasMore: false, loadingMore: false } });
    const btn = wrapper.get('[data-test="mark-all"]');
    await btn.trigger("click");
    expect(wrapper.emitted("markAll")).toHaveLength(1);
  });

  it("shows the unread count in the Needs action header and a Mark all read control", () => {
    const withRead: FeedGroup[] = [
      {
        key: "needs-action",
        label: "Needs action",
        items: [feedItem({ id: "u1" }), feedItem({ id: "r1", read: true })], // 1 unread, 1 sticky-read
      },
    ];
    const wrapper = mount(FeedList, {
      props: { groups: withRead, hasMore: false, loadingMore: false },
    });
    expect(wrapper.get('[data-test="needs-action-count"]').text()).toContain("1 unread");
    expect(wrapper.find('[data-test="mark-all"]').exists()).toBe(true);
  });

  it("collapses the earlier group behind a toggle that reveals the read rows", async () => {
    const wrapper = mount(FeedList, { props: { groups, hasMore: false, loadingMore: false } });
    const toggle = wrapper.get('[data-test="show-earlier"]');
    expect(toggle.text()).toContain("2"); // count of read items
    expect(wrapper.find('[data-test="earlier-list"]').exists()).toBe(false);
    await toggle.trigger("click");
    expect(wrapper.find('[data-test="earlier-list"]').exists()).toBe(true);
  });

  it("omits the earlier toggle when there is no earlier group", () => {
    const wrapper = mount(FeedList, {
      props: { groups: [groups[0]!], hasMore: false, loadingMore: false },
    });
    expect(wrapper.find('[data-test="show-earlier"]').exists()).toBe(false);
  });

  it("renders earlier items with the full card and re-emits unread", async () => {
    const wrapper = mount(FeedList, { props: { groups, hasMore: false, loadingMore: false } });
    await wrapper.get('[data-test="show-earlier"]').trigger("click");
    const list = wrapper.get('[data-test="earlier-list"]');
    // The read cards expose the mark-unread control (proves the full card, not the stripped row).
    await list.get('[data-test="mark-unread"]').trigger("click");
    expect(wrapper.emitted("unread")).toBeTruthy();
  });
});
