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
    const wrapper = mount(FeedList, {
      props: { groups, unread: 2, hasMore: false, loadingMore: false },
    });
    const btn = wrapper.get('[data-test="mark-all"]');
    await btn.trigger("click");
    expect(wrapper.emitted("markAll")).toHaveLength(1);
  });

  it("shows the server unread count in the Needs action header and a Mark all read control", () => {
    const withRead: FeedGroup[] = [
      {
        key: "needs-action",
        label: "Needs action",
        items: [feedItem({ id: "u1" }), feedItem({ id: "r1", read: true })],
      },
    ];
    const wrapper = mount(FeedList, {
      props: { groups: withRead, unread: 1, hasMore: false, loadingMore: false },
    });
    expect(wrapper.get('[data-test="needs-action-count"]').text()).toContain("1 unread");
    expect(wrapper.find('[data-test="mark-all"]').exists()).toBe(true);
  });

  it("hides the unread pill and Mark all read when the server unread count is 0", () => {
    const allRead: FeedGroup[] = [
      {
        key: "needs-action",
        label: "Needs action",
        items: [feedItem({ id: "r1", read: true }), feedItem({ id: "r2", read: true })],
      },
    ];
    const wrapper = mount(FeedList, {
      props: { groups: allRead, unread: 0, hasMore: false, loadingMore: false },
    });
    expect(wrapper.find('[data-test="needs-action-count"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="mark-all"]').exists()).toBe(false);
  });

  it("shows the earlier group expanded by default and the toggle collapses it", async () => {
    const wrapper = mount(FeedList, {
      props: { groups, unread: 2, hasMore: false, loadingMore: false },
    });
    const toggle = wrapper.get('[data-test="show-earlier"]');
    expect(wrapper.find('[data-test="earlier-list"]').exists()).toBe(true); // expanded by default
    expect(toggle.text()).toContain("Hide earlier");
    await toggle.trigger("click");
    expect(wrapper.find('[data-test="earlier-list"]').exists()).toBe(false); // collapsed
    expect(toggle.text()).toContain("2"); // now offers to show the 2 read items
  });

  it("omits the earlier toggle when there is no earlier group", () => {
    const wrapper = mount(FeedList, {
      props: { groups: [groups[0]!], unread: 2, hasMore: false, loadingMore: false },
    });
    expect(wrapper.find('[data-test="show-earlier"]').exists()).toBe(false);
  });

  it("renders earlier items with the full card and re-emits unread", async () => {
    const wrapper = mount(FeedList, {
      props: { groups, unread: 2, hasMore: false, loadingMore: false },
    });
    const list = wrapper.get('[data-test="earlier-list"]'); // expanded by default
    // The read cards expose the read/unread toggle (proves the full card, not the stripped row).
    await list.get('[data-test="read-toggle"]').trigger("click");
    expect(wrapper.emitted("unread")).toBeTruthy();
  });
});
