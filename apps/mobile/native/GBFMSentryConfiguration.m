#import <React/RCTBridgeModule.h>
#import <Sentry/Sentry.h>
#import <Sentry/Sentry-Swift.h>

@interface GBFMSentryConfiguration : NSObject <RCTBridgeModule>
@end

@implementation GBFMSentryConfiguration

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (NSDictionary *)constantsToExport
{
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  NSString *environment = info[@"GBFMSentryEnvironment"];
  if (![@[@"development", @"preview", @"production"] containsObject:environment]) {
#if DEBUG
    environment = @"development";
#else
    environment = @"production";
#endif
  }
  return @{
    @"enabled": @([info[@"GBFMSentryEnabled"] boolValue] && SentrySDK.isEnabled),
    @"dsn": info[@"GBFMSentryDsn"] ?: @"",
    @"release": info[@"GBFMSentryRelease"] ?: @"",
    @"environment": environment,
  };
}

@end
