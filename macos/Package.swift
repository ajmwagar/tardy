// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "TardyMac",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "TardyMac", targets: ["TardyMac"])],
    targets: [
        .executableTarget(
            name: "TardyMac",
            path: "Sources/TardyMac",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "TardyMacTests",
            dependencies: ["TardyMac"],
            path: "Tests/TardyMacTests"
        ),
    ]
)
