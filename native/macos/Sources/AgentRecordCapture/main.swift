import AVFoundation
import AppKit
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

enum CaptureError: LocalizedError {
    case invalidArguments(String)
    case permissionMissing
    case targetNotFound(String)
    case targetAmbiguous([String])
    case writerFailed(String)
    case firstFrameTimeout

    var errorDescription: String? {
        switch self {
        case .invalidArguments(let message):
            return message
        case .permissionMissing:
            return "macOS 尚未授予屏幕录制权限"
        case .targetNotFound(let owner):
            return "找不到可录制的 \(owner) 窗口"
        case .targetAmbiguous(let titles):
            return "找到多个候选窗口，请提供窗口边界：\(titles.joined(separator: "、"))"
        case .writerFailed(let message):
            return "视频编码器失败：\(message)"
        case .firstFrameTimeout:
            return "等待录制首帧超时"
        }
    }
}

private var retainedSignalSources: [DispatchSourceSignal] = []

struct Arguments {
    var command = "record"
    var output = ""
    var owner = "Google Chrome"
    var title = ""
    var fps = 60
    var windowID: CGWindowID?
    var targetBounds: CGRect?

    static func parse(_ values: [String]) throws -> Arguments {
        guard let command = values.first else {
            throw CaptureError.invalidArguments("缺少命令：permission、list 或 record")
        }
        var result = Arguments()
        result.command = command
        var options: [String: String] = [:]
        var index = 1
        while index < values.count {
            let key = values[index]
            guard key.hasPrefix("--"), index + 1 < values.count else {
                throw CaptureError.invalidArguments("参数格式错误：\(key)")
            }
            options[key] = values[index + 1]
            index += 2
        }
        result.output = options["--output"] ?? ""
        result.owner = options["--owner"] ?? result.owner
        result.title = options["--title"] ?? ""
        if let rawWindowID = options["--window-id"], let windowID = UInt32(rawWindowID) {
            result.windowID = windowID
        }
        if let rawFps = options["--fps"], let fps = Int(rawFps), (1...120).contains(fps) {
            result.fps = fps
        }

        let bounds = ["--x", "--y", "--width", "--height"].compactMap { options[$0].flatMap(Double.init) }
        if !bounds.isEmpty {
            guard bounds.count == 4 else {
                throw CaptureError.invalidArguments("窗口边界必须同时提供 x、y、width、height")
            }
            result.targetBounds = CGRect(x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3])
        }
        if command == "record" && result.output.isEmpty {
            throw CaptureError.invalidArguments("record 命令缺少 --output")
        }
        return result
    }
}

func jsonLine(_ value: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
          let string = String(data: data, encoding: .utf8) else {
        return
    }
    FileHandle.standardOutput.write(Data("\(string)\n".utf8))
}

func windowDescription(_ window: SCWindow) -> [String: Any] {
    [
        "windowId": window.windowID,
        "owner": window.owningApplication?.applicationName ?? "",
        "bundleId": window.owningApplication?.bundleIdentifier ?? "",
        "title": window.title ?? "",
        "frame": [
            "x": window.frame.origin.x,
            "y": window.frame.origin.y,
            "width": window.frame.width,
            "height": window.frame.height,
        ],
    ]
}

func squaredDistance(_ left: CGRect, _ right: CGRect) -> CGFloat {
    let leftCenter = CGPoint(x: left.midX, y: left.midY)
    let rightCenter = CGPoint(x: right.midX, y: right.midY)
    let dx = leftCenter.x - rightCenter.x
    let dy = leftCenter.y - rightCenter.y
    let dw = left.width - right.width
    let dh = left.height - right.height
    return dx * dx + dy * dy + dw * dw + dh * dh
}

func selectWindow(from content: SCShareableContent, arguments: Arguments) throws -> SCWindow {
    let ownerNeedle = arguments.owner.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
    let titleNeedle = arguments.title.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
    var candidates = content.windows.filter { window in
        let owner = (window.owningApplication?.applicationName ?? "")
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        let title = (window.title ?? "")
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        let ownerMatches = owner.contains(ownerNeedle)
        let titleMatches = titleNeedle.isEmpty || title.contains(titleNeedle)
        return ownerMatches && titleMatches && window.isOnScreen &&
            window.frame.width >= 480 && window.frame.height >= 320
    }
    guard !candidates.isEmpty else {
        throw CaptureError.targetNotFound(arguments.owner)
    }

    if let windowID = arguments.windowID {
        guard let exactWindow = candidates.first(where: { $0.windowID == windowID }) else {
            throw CaptureError.targetNotFound(arguments.owner)
        }
        return exactWindow
    }

    if let targetBounds = arguments.targetBounds {
        candidates.sort { squaredDistance($0.frame, targetBounds) < squaredDistance($1.frame, targetBounds) }
        return candidates[0]
    }
    candidates.sort { ($0.frame.width * $0.frame.height) > ($1.frame.width * $1.frame.height) }
    if candidates.count > 1 {
        let firstArea = candidates[0].frame.width * candidates[0].frame.height
        let secondArea = candidates[1].frame.width * candidates[1].frame.height
        if secondArea >= firstArea * 0.72 {
            throw CaptureError.targetAmbiguous(candidates.prefix(4).map { $0.title ?? "未命名窗口" })
        }
    }
    return candidates[0]
}

func captureScale(for window: SCWindow, in content: SCShareableContent) -> CGFloat {
    let center = CGPoint(x: window.frame.midX, y: window.frame.midY)
    guard let display = content.displays.first(where: { $0.frame.contains(center) }),
          display.frame.width > 0 else {
        return 1
    }
    return CGFloat(display.width) / display.frame.width
}

final class CaptureWriter: NSObject, SCStreamOutput, SCStreamDelegate {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var stream: SCStream!
    private let outputURL: URL
    private let width: Int
    private let height: Int
    private let fps: Int
    private let window: SCWindow
    private let captureQueue = DispatchQueue(label: "app.agent-record.capture.frames", qos: .userInteractive)
    private let stateLock = NSLock()
    private var firstTimestamp: CMTime?
    private var lastTimestamp: CMTime?
    private var frameCount = 0
    private var droppedFrames = 0
    private var ready = false
    private var stopping = false
    private var startError = ""

    init(window: SCWindow, content: SCShareableContent, arguments: Arguments) throws {
        self.window = window
        self.outputURL = URL(fileURLWithPath: arguments.output)
        self.fps = arguments.fps
        let scale = captureScale(for: window, in: content)
        self.width = max(2, Int((window.frame.width * scale).rounded()) / 2 * 2)
        self.height = max(2, Int((window.frame.height * scale).rounded()) / 2 * 2)
        self.writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        self.input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: 28_000_000,
                    AVVideoExpectedSourceFrameRateKey: fps,
                    AVVideoMaxKeyFrameIntervalKey: fps * 2,
                    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                ],
            ]
        )
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw CaptureError.writerFailed("无法创建 H.264 视频输入")
        }
        writer.add(input)

        let configuration = SCStreamConfiguration()
        configuration.width = width
        configuration.height = height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        configuration.queueDepth = 8
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = false
        configuration.capturesAudio = false
        configuration.scalesToFit = true
        let filter = SCContentFilter(desktopIndependentWindow: window)
        super.init()
        self.stream = SCStream(filter: filter, configuration: configuration, delegate: self)
    }

    func start() async throws {
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: captureQueue)
        try await stream.startCapture()
        for _ in 0..<100 {
            let status = startStatus()
            if status.ready { return }
            if !status.error.isEmpty {
                try? await stream.stopCapture()
                throw CaptureError.writerFailed(status.error)
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        try? await stream.stopCapture()
        throw CaptureError.firstFrameTimeout
    }

    func stop() async {
        guard markStopping() else { return }

        try? await stream.stopCapture()
        input.markAsFinished()
        await withCheckedContinuation { continuation in
            writer.finishWriting {
                continuation.resume()
            }
        }
        let status = writer.status == .completed ? "finished" : "failed"
        let durationMs: Int
        if let firstTimestamp, let lastTimestamp {
            durationMs = max(0, Int((lastTimestamp.seconds - firstTimestamp.seconds) * 1000))
        } else {
            durationMs = 0
        }
        jsonLine([
            "type": status,
            "output": outputURL.path,
            "frameCount": frameCount,
            "droppedFrames": droppedFrames,
            "durationMs": durationMs,
            "error": writer.error?.localizedDescription ?? "",
        ])
        fflush(stdout)
        exit(writer.status == .completed ? 0 : 1)
    }

    private func startStatus() -> (ready: Bool, error: String) {
        stateLock.lock()
        defer { stateLock.unlock() }
        return (ready, startError)
    }

    private func markStopping() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        if stopping { return false }
        stopping = true
        return true
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen, sampleBuffer.isValid else { return }
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer,
            createIfNecessary: false
        ) as? [[SCStreamFrameInfo: Any]],
            let statusRaw = attachments.first?[.status] as? Int,
            let status = SCFrameStatus(rawValue: statusRaw),
            status == .complete else {
            stateLock.lock()
            droppedFrames += 1
            stateLock.unlock()
            return
        }

        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        stateLock.lock()
        defer { stateLock.unlock() }
        guard !stopping else { return }
        if firstTimestamp == nil {
            guard writer.startWriting() else {
                startError = writer.error?.localizedDescription ?? "编码器无法启动"
                jsonLine([
                    "type": "error",
                    "code": "ENCODER_START_FAILED",
                    "message": startError,
                ])
                return
            }
            firstTimestamp = timestamp
            writer.startSession(atSourceTime: timestamp)
        }
        guard input.isReadyForMoreMediaData else {
            droppedFrames += 1
            return
        }
        guard input.append(sampleBuffer) else {
            droppedFrames += 1
            return
        }
        lastTimestamp = timestamp
        frameCount += 1
        if !ready {
            ready = true
            jsonLine([
                "type": "ready",
                "window": windowDescription(window),
                "width": width,
                "height": height,
                "fps": fps,
                "output": outputURL.path,
            ])
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        stateLock.lock()
        startError = error.localizedDescription
        stateLock.unlock()
        jsonLine([
            "type": "error",
            "code": "CAPTURE_RUNTIME_ERROR",
            "message": error.localizedDescription,
        ])
    }
}

func run() async throws {
    let arguments = try Arguments.parse(Array(CommandLine.arguments.dropFirst()))
    if arguments.command == "permission" {
        jsonLine(["granted": CGPreflightScreenCaptureAccess()])
        return
    }

    guard CGPreflightScreenCaptureAccess() else {
        throw CaptureError.permissionMissing
    }
    await MainActor.run {
        _ = NSApplication.shared
        NSApplication.shared.setActivationPolicy(.prohibited)
    }
    let content = try await SCShareableContent.excludingDesktopWindows(
        true,
        onScreenWindowsOnly: true
    )
    if arguments.command == "list" {
        let windows = content.windows
            .filter { $0.isOnScreen && $0.frame.width >= 320 && $0.frame.height >= 240 }
            .map(windowDescription)
        jsonLine(["windows": windows])
        return
    }
    guard arguments.command == "record" else {
        throw CaptureError.invalidArguments("未知命令：\(arguments.command)")
    }

    let window = try selectWindow(from: content, arguments: arguments)
    let outputURL = URL(fileURLWithPath: arguments.output)
    try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    if FileManager.default.fileExists(atPath: outputURL.path) {
        throw CaptureError.invalidArguments("输出文件已存在：\(outputURL.path)")
    }

    let capture = try CaptureWriter(window: window, content: content, arguments: arguments)
    try await capture.start()

    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)
    let interruptSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    let terminateSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    interruptSource.setEventHandler {
        Task { await capture.stop() }
    }
    terminateSource.setEventHandler {
        Task { await capture.stop() }
    }
    interruptSource.resume()
    terminateSource.resume()
    retainedSignalSources = [interruptSource, terminateSource]
    while true {
        try await Task.sleep(nanoseconds: 3_600_000_000_000)
    }
}

Task {
    do {
        try await run()
        exit(0)
    } catch {
        jsonLine([
            "type": "error",
            "code": "CAPTURE_START_FAILED",
            "message": error.localizedDescription,
        ])
        exit(1)
    }
}
dispatchMain()
