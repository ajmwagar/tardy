import Testing
@testable import TardyMac

@Test func agentActivityUsesRuntimeDetailAndSemanticSymbol() {
    let activity = AgentActivityPresentation.make(status: "tool", detail: "Editing files")
    #expect(activity.title == "Editing files")
    #expect(activity.symbol == "doc.badge.gearshape.fill")
    #expect(activity.showsProgress)
}

@Test func structuredActivityUsesStableKindInsteadOfParsingItsTitle() {
    let activity = ConversationActivity(
        id: "change-1",
        kind: "file_change",
        title: "Updating the macOS message renderer",
        phase: "completed"
    )
    let presentation = AgentActivityPresentation.make(activity: activity)
    #expect(presentation.symbol == "doc.badge.gearshape.fill")
    #expect(!presentation.showsProgress)
}

@Test func agentActivityPresentsWritingAndFinalizingWithoutTransportTerms() {
    let writing = AgentActivityPresentation.make(status: "writing", detail: "")
    #expect(writing.title == "Writing a response")
    #expect(writing.showsProgress)

    let finalizing = AgentActivityPresentation.make(status: "finalizing", detail: "")
    #expect(finalizing.title == "Finishing up")
    #expect(!finalizing.showsProgress)
}
