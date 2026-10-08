import AuthenticationServices
import CryptoKit
import SwiftUI

struct AppleSessionRequest: Encodable, Sendable {
    let provider = "apple"
    let identityToken: String
    let authorizationCode: String
    let nonce: String
    let fullName: String?
}

// Keep the authorization transaction in reference storage: AuthenticationServices
// callbacks can outlive the SwiftUI view value that started the request.
@MainActor
final class AppleAuthorizationTransaction {
    private var pending: (nonce: String, state: String)?

    func begin() -> (hashedNonce: String, state: String) {
        if let pending {
            return (SHA256.hash(data: Data(pending.nonce.utf8)).map { String(format: "%02x", $0) }.joined(), pending.state)
        }
        let nonce = UUID().uuidString + UUID().uuidString
        let state = UUID().uuidString
        pending = (nonce, state)
        return (SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined(), state)
    }

    func consume(state: String?) -> String? {
        defer { pending = nil }
        guard let pending, state == pending.state else { return nil }
        return pending.nonce
    }

    func cancel() { pending = nil }
}

struct AppleSignInButton: View {
    @Environment(AppModel.self) private var model
    @State private var transaction = AppleAuthorizationTransaction()
    @State private var signingIn = false
    private var isProvisioned: Bool {
        Bundle.main.object(forInfoDictionaryKey: "TardyAppleSignInConfigured") as? Bool == true
    }
    var body: some View {
        SignInWithAppleButton(.signIn) { request in
            signingIn = true
            let challenge = transaction.begin()
            request.requestedScopes = [.fullName, .email]
            request.nonce = challenge.hashedNonce
            request.state = challenge.state
        } onCompletion: { result in
            switch result {
            case .success(let authorization):
                guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                      let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }),
                      let code = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) else {
                    model.errorMessage = "Apple did not return a sign-in credential."
                    transaction.cancel()
                    signingIn = false
                    return
                }
                guard let nonce = transaction.consume(state: credential.state) else {
                    model.errorMessage = "Apple sign-in request expired or did not match. Please try again."
                    signingIn = false
                    return
                }
                let name = credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) }
                let request = AppleSessionRequest(identityToken: token, authorizationCode: code, nonce: nonce, fullName: name)
                Task {
                    await model.appleSignIn(credential: request)
                    signingIn = false
                }
            case .failure(let error):
                transaction.cancel()
                signingIn = false
                model.errorMessage = "Apple sign-in failed: \(error.localizedDescription). This Mac build requires Apple Sign in provisioning."
            }
        }
        .signInWithAppleButtonStyle(.white)
        .disabled(!isProvisioned || signingIn)
        .help(isProvisioned ? "Sign in to your Tardy account" : "This Mac build needs its Apple sign-in provisioning profile.")
        .frame(width: 320, height: 44)
    }
}
