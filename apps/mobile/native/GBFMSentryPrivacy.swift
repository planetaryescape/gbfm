import Foundation
import Sentry

enum GBFMSentryPrivacy {
  static func configure(_ options: Options) {
    options.sendDefaultPii = false
    options.enableAutoSessionTracking = true
    options.enableAutoBreadcrumbTracking = false
    options.enableNetworkBreadcrumbs = false
    options.enableNetworkTracking = false
    options.enableCaptureFailedRequests = false
    options.enableLogs = false
    #if os(iOS)
      options.attachScreenshot = false
      options.attachViewHierarchy = false
    #endif
    options.beforeBreadcrumb = { _ in nil }
    options.beforeSend = sanitize
  }

  static func sanitize(_ event: Event) -> Event {
    let clean = Event(level: event.level)
    clean.eventId = event.eventId
    clean.timestamp = event.timestamp
    clean.platform = "cocoa"
    clean.releaseName = event.releaseName
    clean.dist = event.dist
    clean.environment = event.environment
    clean.sdk = event.sdk
    if event.tags?["event.origin"] == "ios",
      event.tags?["event.environment"] == "native"
    {
      clean.tags = ["event.origin": "ios", "event.environment": "native"]
    }
    if let trace = event.context?["trace"],
      let traceId = trace["trace_id"] as? String,
      let spanId = trace["span_id"] as? String,
      traceId.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
      spanId.range(of: "^[a-f0-9]{16}$", options: .regularExpression) != nil
    {
      var context: [String: Any] = [
        "trace_id": traceId, "span_id": spanId, "op": "application.operation",
      ]
      if let parent = trace["parent_span_id"] as? String,
        parent.range(of: "^[a-f0-9]{16}$", options: .regularExpression) != nil
      {
        context["parent_span_id"] = parent
      }
      clean.context = ["trace": context]
    }
    clean.exceptions = event.exceptions?.map { exception in
      let clean = Exception(value: "Unexpected native application error", type: exceptionType(exception.type))
      clean.threadId = exception.threadId
      clean.stacktrace = stacktrace(exception.stacktrace)
      clean.mechanism = mechanism(exception.mechanism)
      return clean
    }
    clean.stacktrace = stacktrace(event.stacktrace)
    clean.threads = event.threads?.map { thread in
      let clean = SentryThread(threadId: thread.threadId)
      clean.crashed = thread.crashed
      clean.current = thread.current
      clean.isMain = thread.isMain
      clean.stacktrace = stacktrace(thread.stacktrace)
      return clean
    }
    clean.debugMeta = event.debugMeta?.map { image in
      let clean = DebugMeta()
      clean.debugID = image.debugID
      clean.type = image.type
      clean.imageSize = image.imageSize
      clean.imageAddress = image.imageAddress
      clean.imageAddressRaw = image.imageAddressRaw
      clean.imageVmAddress = image.imageVmAddress
      clean.imageVmAddressRaw = image.imageVmAddressRaw
      clean.codeFile = imagePath(image.codeFile)
      return clean
    }
    if clean.exceptions?.isEmpty != false {
      clean.message = SentryMessage(formatted: "Native application diagnostic")
    }
    var contexts = clean.context ?? [:]
    if let source = event.context?["os"] {
      var os: [String: Any] = [:]
      if let name = source["name"] as? String,
        ["iOS", "iPadOS", "macOS", "tvOS", "watchOS", "visionOS", "Darwin"].contains(name)
      { os["name"] = name }
      if let version = bounded(source["version"], pattern: "^[0-9]+(?:\\.[0-9]+){0,3}$") { os["version"] = version }
      if let build = bounded(source["build"], pattern: "^[0-9]{1,3}[A-Z][0-9]{1,6}[a-z]?$") { os["build"] = build }
      if !os.isEmpty { contexts["os"] = os }
    }
    if let source = event.context?["device"] {
      var device: [String: Any] = [:]
      if let arch = source["arch"] as? String,
        ["arm64", "arm64e", "x86_64", "armv7", "armv7s", "i386"].contains(arch)
      { device["arch"] = arch }
      if let model = bounded(source["model"], pattern: "^(?:iPhone|iPad|iPod|Mac|MacBookPro|MacBookAir|Macmini|MacPro|iMac|AppleTV|Watch|RealityDevice)(?:[0-9]+,[0-9]+)?$") {
        device["model"] = model
      }
      if !device.isEmpty { contexts["device"] = device }
    }
    clean.context = contexts.isEmpty ? nil : contexts
    return clean
  }

  private static func exceptionType(_ value: String?) -> String {
    let allowed: Set<String> = [
      "NSException", "NSError", "NSInvalidArgumentException", "NSRangeException",
      "NSInternalInconsistencyException", "NSGenericException", "NSMallocException",
      "EXC_BAD_ACCESS", "EXC_BAD_INSTRUCTION", "EXC_CRASH",
      "EXC_BREAKPOINT", "EXC_GUARD", "EXC_RESOURCE", "EXC_ARITHMETIC",
      "SIGABRT", "SIGSEGV", "SIGILL", "SIGBUS", "SIGFPE", "SIGTRAP",
      "WatchdogTermination", "App Hanging", "App Hang Fully Blocked",
      "App Hang Non Fully Blocked", "Fatal App Hang Fully Blocked",
      "Fatal App Hang Non Fully Blocked",
    ]
    guard let value, allowed.contains(value) else { return "NativeError" }
    return value
  }

  private static func basename(_ value: String?) -> String? {
    guard let value else { return nil }
    let path = String(value.prefix { $0 != "?" && $0 != "#" })
    return URL(fileURLWithPath: path).lastPathComponent
  }

  private static func bounded(_ value: Any?, pattern: String) -> String? {
    guard let value = value as? String, value.utf8.count <= 64,
      value.range(of: pattern, options: .regularExpression) != nil
    else { return nil }
    return value
  }

  private static func imagePath(_ value: String?) -> String? {
    guard let value else { return nil }
    let path = String(value.prefix { $0 != "?" && $0 != "#" })
    if path.hasPrefix("/System/Library/") || path.hasPrefix("/usr/lib/") { return path }
    if let range = path.range(of: "[^/]+\\.app(?:/.*)?$", options: .regularExpression) {
      return String(path[range])
    }
    return basename(path)
  }

  private static func mechanism(_ value: Mechanism?) -> Mechanism? {
    guard let value else { return nil }
    let types: Set<String> = [
      "generic", "mach", "signal", "nsexception", "cpp_exception", "user",
      "AppHang", "watchdog_termination",
    ]
    let clean = Mechanism(type: types.contains(value.type) ? value.type : "generic")
    clean.handled = value.handled
    clean.synthetic = value.synthetic
    if let address = bounded(value.data?["relevant_address"], pattern: "^0x[0-9a-fA-F]{1,16}$") {
      clean.data = ["relevant_address": address]
    }
    if let source = value.meta {
      let meta = MechanismContext()
      if let signal = source.signal {
        var fields: [String: Any] = [:]
        for key in ["number", "code"] {
          if let number = signal[key] as? NSNumber { fields[key] = number }
        }
        if let name = signal["name"] as? String,
          ["SIGABRT", "SIGSEGV", "SIGILL", "SIGBUS", "SIGFPE", "SIGTRAP"].contains(name)
        { fields["name"] = name }
        meta.signal = fields
      }
      if let mach = source.machException {
        var fields: [String: Any] = [:]
        for key in ["exception", "code", "subcode"] {
          if let number = mach[key] as? NSNumber { fields[key] = number }
        }
        if let name = mach["name"] as? String, exceptionType(name) == name { fields["name"] = name }
        meta.machException = fields
      }
      clean.meta = meta
    }
    return clean
  }

  private static func stacktrace(_ value: SentryStacktrace?) -> SentryStacktrace? {
    guard let value else { return nil }
    let frames = value.frames.map { frame in
      let clean = Frame()
      clean.instructionAddress = frame.instructionAddress
      clean.imageAddress = frame.imageAddress
      clean.symbolAddress = frame.symbolAddress
      clean.function = frame.function
      clean.fileName = basename(frame.fileName)
      clean.package = imagePath(frame.package)
      clean.module = imagePath(frame.module)
      clean.lineNumber = frame.lineNumber
      clean.columnNumber = frame.columnNumber
      clean.inApp = frame.inApp
      clean.platform = frame.platform
      return clean
    }
    let clean = SentryStacktrace(frames: frames, registers: [:])
    clean.snapshot = value.snapshot
    return clean
  }
}
