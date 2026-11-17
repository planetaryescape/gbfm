import Foundation
import RNSentry
import Sentry

enum GBFMSentryBootstrap {
  static func start() {
    let info = Bundle.main.infoDictionary ?? [:]
    guard info["GBFMSentryEnabled"] as? Bool == true,
      let dsn = info["GBFMSentryDsn"] as? String,
      let release = info["GBFMSentryRelease"] as? String
    else { return }

    let stage = environment(info["GBFMSentryEnvironment"] as? String)
    RNSentrySDK.start { options in
      options.dsn = dsn
      options.enabled = true
      options.releaseName = release
      options.environment = stage
      GBFMSentryPrivacy.configure(options)
    }
    if stage == "development",
      ProcessInfo.processInfo.environment["GBFM_SENTRY_VERIFY_NATIVE"] == release
    {
      let exception = NSException(
        name: NSExceptionName("GBFMNativeVerification"),
        reason: "synthetic-native-secret-do-not-export",
        userInfo: ["token": "synthetic-native-secret-do-not-export"]
      )
      let eventId = SentrySDK.capture(exception: exception)
      NSLog("GBFM_NATIVE_VERIFICATION_EVENT=%@", eventId.sentryIdString)
      SentrySDK.flush(timeout: 2)
    }
  }

  private static func environment(_ value: String?) -> String {
    if let value, ["development", "preview", "production"].contains(value) { return value }
    #if DEBUG
      return "development"
    #else
      return "production"
    #endif
  }
}
