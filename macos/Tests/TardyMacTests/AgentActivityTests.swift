import Testing
@testable import TardyMac

@Test func agentActivityUsesRuntimeDetailAndSemanticSymbol() {
    let activity = AgentActivityPresentation.make(status: "tool", detail: "Editing files")
    #expect(activity.title == "Editing files")
    #expect(activity.symbol == "doc.badge.gearshape.fill")
    #expect(activity.showsProgress)
}

@Test func agentActivityPresentsWritingAndFinalizingWithoutTransportTerms() {
    let writing = AgentActivityPresentation.make(status: "writing", detail: "")
    #expect(writing.title == "Writing a response")
    #expect(writing.showsProgress)

    let finalizing = AgentActivityPresentation.make(status: "finalizing", detail: "")
    #expect(finalizing.title == "Finishing up")
    #expect(!finalizing.showsProgress)
}
