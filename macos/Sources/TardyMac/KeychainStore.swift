import Foundation
import Security

enum KeychainStore {
    private static let service = "dev.fpl.tardy.macos"

    static func loadToken(environment: ServerEnvironment) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: environment.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func saveToken(_ token: String, environment: ServerEnvironment) throws {
        let selector: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: environment.keychainAccount,
        ]
        SecItemDelete(selector as CFDictionary)
        var item = selector
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    static func clear(environment: ServerEnvironment) { SecItemDelete([
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: environment.keychainAccount,
    ] as CFDictionary) }
}

enum KeychainError: Error { case status(OSStatus) }
