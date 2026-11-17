import Foundation
import Sentry

@main
enum NativePrivacyVerification {
  static func main() throws {
    let secret = "synthetic-native-secret-do-not-export"
    let frame = Frame()
    frame.fileName = "/Users/\(secret)/NativePrivacyVerification.swift?token=\(secret)"
    frame.function = "NativePrivacyVerification.main"
    frame.instructionAddress = "0x100001234"
    frame.imageAddress = "0x100000000"
    frame.contextLine = secret
    frame.vars = ["token": secret]
    let stack = SentryStacktrace(frames: [frame], registers: ["private": secret])
    let exception = Exception(value: secret, type: "NSInvalidArgumentException")
    exception.stacktrace = stack
    let thread = SentryThread(threadId: 1)
    thread.name = secret
    thread.stacktrace = stack
    thread.crashed = true
    let image = DebugMeta()
    image.debugID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"
    image.type = "macho"
    image.codeFile = "/Users/\(secret)/gbfm"
    image.imageAddress = "0x100000000"
    let event = Event(level: .error)
    event.platform = secret
    event.releaseName = "gbfm-mobile@" + String(repeating: "a", count: 40)
    event.environment = "development"
    event.message = SentryMessage(formatted: secret)
    event.user = User(userId: secret)
    event.extra = ["token": secret]
    event.tags = ["private": secret]
    event.context = [
      "private": ["token": secret],
      "trace": ["trace_id": String(repeating: "1", count: 32), "span_id": String(repeating: "2", count: 16), "private": secret],
    ]
    event.exceptions = [exception]
    event.threads = [thread]
    event.debugMeta = [image]
    let raw = try JSONSerialization.data(withJSONObject: event.serialize())
    precondition(String(decoding: raw, as: UTF8.self).contains(secret))
    let clean = GBFMSentryPrivacy.sanitize(event)
    let serialized = try JSONSerialization.data(withJSONObject: clean.serialize(), options: [.sortedKeys])
    let text = String(decoding: serialized, as: UTF8.self)
    precondition(!text.contains(secret))
    precondition(text.contains("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"))
    precondition(text.contains("0x100001234"))
    precondition(text.contains("NativePrivacyVerification.main"))
    precondition(clean.threads?.first?.crashed == true)
    precondition(clean.context?["trace"]?["span_id"] as? String == String(repeating: "2", count: 16))
    precondition(clean.eventId == event.eventId)
    precondition(clean.exceptions?.first?.type == "NSInvalidArgumentException")
    let options = Options()
    GBFMSentryPrivacy.configure(options)
    precondition(options.beforeBreadcrumb?(Breadcrumb()) == nil)
    precondition(options.beforeSend?(event)?.extra == nil)
    precondition(!options.sendDefaultPii)
    precondition(!options.enableNetworkBreadcrumbs)
    precondition(!options.enableNetworkTracking)
    if let dsn = ProcessInfo.processInfo.environment["GBFM_NATIVE_CAPTURE_DSN"] {
      precondition(URL(string: dsn)?.host == "127.0.0.1")
      options.dsn = dsn
      options.releaseName = event.releaseName
      options.environment = "development"
      options.enableAutoSessionTracking = false
      SentrySDK.start(options: options)
      SentrySDK.capture(event: event)
      SentrySDK.capture(exception: NSException(
        name: NSExceptionName.invalidArgumentException,
        reason: secret,
        userInfo: ["token": secret]
      ))
      SentrySDK.flush(timeout: 5)
      SentrySDK.close()
    }
    print("Native privacy projection passed")
  }
}
