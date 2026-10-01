(() => {
  "use strict";

  const id = document.querySelector('meta[name="wideline-id"]')?.content;
  if (!id) throw new Error("Tardy analytics requires a Wideline pixel id");

  window.addEventListener("DOMContentLoaded", async () => {
    if (!window.Wideline?.createTracker) {
      console.error("Wideline SDK did not load; Tardy analytics is unavailable");
      return;
    }

    try {
      const tracker = window.Wideline.createTracker({ widelineId: id });
      window.wideline = tracker;
      await tracker.ready();
      tracker.track("ViewContent", {
        contentId: "tardy-agent-landing",
        contentName: document.title,
        contentType: "landing_page",
      });

      document.addEventListener("click", (event) => {
        const link = event.target.closest("a");
        if (!link) return;
        const destination = link.getAttribute("href") || "";
        if (destination === "#agents") {
          tracker.track("Lead", { contentId: "connect-agent", destination });
        } else if (destination === "/ios") {
          tracker.track("ViewContent", { contentId: "ios-app", contentType: "app_download", destination });
        }
      });
    } catch (error) {
      console.error("Wideline initialization failed", error);
    }
  });
})();
