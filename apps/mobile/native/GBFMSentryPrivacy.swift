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
      if let handled = exception.mechanism?.handled {
        let mechanism = Mechanism(type: "generic")
        mechanism.handled = handled
        clean.mechanism = mechanism
      }
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
      clean.codeFile = basename(image.codeFile)
      return clean
    }
    if clean.exceptions?.isEmpty != false {
      clean.message = SentryMessage(formatted: "Native application diagnostic")
    }
    return clean
  }

  private static func exceptionType(_ value: String?) -> String {
    let allowed: Set<String> = [
      "NSException", "NSError", "NSInvalidArgumentException", "NSRangeException",
      "NSInternalInconsistencyException", "NSGenericException", "NSMallocException",
      "EXC_BAD_ACCESS", "EXC_BAD_INSTRUCTION", "EXC_CRASH",
      "SIGABRT", "SIGSEGV", "SIGILL", "SIGBUS", "SIGFPE",
    ]
    guard let value, allowed.contains(value) else { return "NativeError" }
    return value
  }

  private static func basename(_ value: String?) -> String? {
    guard let value else { return nil }
    let path = String(value.prefix { $0 != "?" && $0 != "#" })
    return URL(fileURLWithPath: path).lastPathComponent
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
      clean.package = basename(frame.package)
      clean.module = basename(frame.module)
      clean.lineNumber = frame.lineNumber
      clean.columnNumber = frame.columnNumber
      clean.inApp = frame.inApp
      clean.platform = frame.platform
      return clean
    }
    return SentryStacktrace(frames: frames, registers: [:])
  }
}
