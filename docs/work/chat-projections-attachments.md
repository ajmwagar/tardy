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
reply. The projection is a literal prefix, not an AI-generated summary. Both live
drafts and completed replies use the same component. Existing native Markdown
renders expanded content; Streamdown is not embedded in this slice.

iOS keeps long text collapsible, adds a virtualized attachment grid, image swipe
navigation and Previous / Next buttons, reuses existing typed media previews, and
links back to the original message. Unmeasured chat rows use bounded scroll retries.

Verification: macOS build and 21 Swift tests passed; 4 mobile attachment tests
passed; mobile TypeScript and lint passed. Gesture and layout behavior still needs
interactive device QA; no TestFlight upload was performed.
