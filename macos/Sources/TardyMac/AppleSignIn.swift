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

struct AppleSignInButton: View {
    @Environment(AppModel.self) private var model
    @State private var nonce = ""
    var body: some View {
        SignInWithAppleButton(.signIn) { request in
            nonce = UUID().uuidString + UUID().uuidString
            request.requestedScopes = [.fullName, .email]
            request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
        } onCompletion: { result in
            switch result {
            case .success(let authorization):
                guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                      let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }),
                      let code = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) else {
                    model.errorMessage = "Apple did not return a sign-in credential."
                    return
                }
                let name = credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) }
                let request = AppleSessionRequest(identityToken: token, authorizationCode: code, nonce: nonce, fullName: name)
                Task { await model.appleSignIn(credential: request) }
            case .failure(let error):
                model.errorMessage = "Apple sign-in failed: \(error.localizedDescription). This Mac build requires Apple Sign in provisioning."
            }
        }
        .signInWithAppleButtonStyle(.white)
        .frame(width: 320, height: 44)
    }
}
