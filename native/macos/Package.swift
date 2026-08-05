// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "AgentRecordCapture",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(
            name: "agent-record-capture",
            targets: ["AgentRecordCapture"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "AgentRecordCapture",
            path: "Sources/AgentRecordCapture"
        ),
    ]
)
