# Chat projections and conversation attachments

User-authorized Markdown tracker fallback, 2026-10-05. Central Marbles login
returns `401 invalid_client`; no central claim has been created.

Scope: native macOS Chat / Expanded presentation of the same message, keeping
media separate; conversation attachment navigation on macOS and iOS. No backend
summary generation, new web renderer, or remote deployment in this slice.

The browser indexes the currently loaded conversation messages, not an implied
complete historical media archive. Show in chat targets the original message.

Status: implemented locally; not deployed or published to TestFlight.

macOS uses a persistent Chat / Expanded preference, with per-message Read full
reply. The compact projection is line-clamped attributed text, not an AI-generated summary. Both live
drafts and completed replies use the same component. Existing native Markdown
renders expanded content; Streamdown is not embedded in this slice.

iOS keeps long text collapsible, adds a virtualized attachment grid, image swipe
navigation and Previous / Next buttons, reuses existing typed media previews, and
links back to the original message. Unmeasured chat rows use bounded scroll retries.

Reworked after user UX review: desktop media now opens beside the conversation,
with thumbnail filters and in-app photo/video/audio previews, original-file links,
and an original-message highlight. Header layout actions live in one menu instead
of several competing buttons. Expanded fenced code has copy controls and is not
misinterpreted as a Markdown table. iOS photos use native horizontal paging, with
pinned navigation and filtered media browsing; document previews scroll separately.

Verification: macOS build and 23 Swift tests passed; 4 mobile attachment tests
passed; mobile TypeScript and lint passed. Gesture and layout behavior still needs
interactive iOS device QA; no TestFlight upload was performed. The macOS app was
relaunched as @ajmwagar and its switcher and media preview were exercised via
Accessibility and inspected in a window screenshot. That inspection caught a
wrapped picker label (now hidden). The existing proraw-release-test.jpg attachment
shows unavailable: its backing-media availability is not resolved by this UI work.
