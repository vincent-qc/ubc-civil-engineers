#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>

static CFAbsoluteTime recordStartTime = 0;
static CGRect recordDesktopBounds;
static double recordScaleX = 1;
static double recordScaleY = 1;
static CFMachPortRef recordEventTap = NULL;

static void Fail(NSString *message) {
  fprintf(stderr, "%s\n", [message UTF8String]);
  exit(1);
}

static double ArgDouble(NSArray<NSString *> *args, NSUInteger index, NSString *name) {
  if ([args count] <= index) {
    Fail([NSString stringWithFormat:@"Expected %@", name]);
  }
  return [args[index] doubleValue];
}

static CGRect DesktopBounds(void) {
  uint32_t count = 0;
  CGError result = CGGetActiveDisplayList(0, NULL, &count);
  if (result != kCGErrorSuccess || count == 0) {
    Fail(@"Unable to count active displays.");
  }

  CGDirectDisplayID *displays = calloc(count, sizeof(CGDirectDisplayID));
  if (!displays) {
    Fail(@"Unable to allocate display list.");
  }

  result = CGGetActiveDisplayList(count, displays, &count);
  if (result != kCGErrorSuccess) {
    free(displays);
    Fail(@"Unable to list active displays.");
  }

  CGRect bounds = CGRectNull;
  for (uint32_t index = 0; index < count; index++) {
    bounds = CGRectUnion(bounds, CGDisplayBounds(displays[index]));
  }

  free(displays);
  return bounds;
}

static CGRect DesktopBoundsForRecording(void) {
  uint32_t count = 0;
  CGError result = CGGetActiveDisplayList(0, NULL, &count);
  if (result != kCGErrorSuccess || count == 0) {
    CGDirectDisplayID mainDisplay = CGMainDisplayID();
    CGRect fallback = CGDisplayBounds(mainDisplay);
    if (!CGRectIsEmpty(fallback)) {
      return fallback;
    }
    return CGRectMake(0, 0, 1, 1);
  }

  CGDirectDisplayID *displays = calloc(count, sizeof(CGDirectDisplayID));
  if (!displays) {
    return CGRectMake(0, 0, 1, 1);
  }

  result = CGGetActiveDisplayList(count, displays, &count);
  if (result != kCGErrorSuccess) {
    free(displays);
    return CGRectMake(0, 0, 1, 1);
  }

  CGRect bounds = CGRectNull;
  for (uint32_t index = 0; index < count; index++) {
    bounds = CGRectUnion(bounds, CGDisplayBounds(displays[index]));
  }

  free(displays);
  return CGRectIsNull(bounds) || CGRectIsEmpty(bounds) ? CGRectMake(0, 0, 1, 1) : bounds;
}

static void PrintJSON(NSDictionary *object) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:&error];
  if (!data) {
    Fail([NSString stringWithFormat:@"Unable to encode JSON: %@", error.localizedDescription]);
  }

  NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  printf("%s\n", [text UTF8String]);
}

static void PrintJSONLine(NSDictionary *object) {
  PrintJSON(object);
  fflush(stdout);
}

static void Screenshot(void) {
  CGRect bounds = DesktopBounds();
  CGImageRef image = CGWindowListCreateImage(
    bounds,
    kCGWindowListOptionOnScreenOnly,
    kCGNullWindowID,
    kCGWindowImageBestResolution
  );

  if (!image) {
    Fail(@"Unable to capture desktop. Grant Screen Recording permission to the terminal/app launching Electron.");
  }

  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  if (!png) {
    CGImageRelease(image);
    Fail(@"Unable to encode desktop screenshot.");
  }

  NSDictionary *payload = @{
    @"pngBase64": [png base64EncodedStringWithOptions:0],
    @"width": @((NSInteger)CGImageGetWidth(image)),
    @"height": @((NSInteger)CGImageGetHeight(image)),
    @"originX": @(bounds.origin.x),
    @"originY": @(bounds.origin.y),
    @"scaleX": @((double)CGImageGetWidth(image) / MAX((double)bounds.size.width, 1.0)),
    @"scaleY": @((double)CGImageGetHeight(image) / MAX((double)bounds.size.height, 1.0))
  };

  PrintJSON(payload);
  CGImageRelease(image);
}

static NSString *MouseButtonName(CGMouseButton button) {
  if (button == kCGMouseButtonLeft) {
    return @"left";
  }
  if (button == kCGMouseButtonRight) {
    return @"right";
  }
  if (button == kCGMouseButtonCenter) {
    return @"middle";
  }
  return [NSString stringWithFormat:@"button_%d", button];
}

static NSString *ModifierNames(CGEventFlags flags) {
  NSMutableArray<NSString *> *modifiers = [NSMutableArray array];
  if (flags & kCGEventFlagMaskCommand) {
    [modifiers addObject:@"command"];
  }
  if (flags & kCGEventFlagMaskControl) {
    [modifiers addObject:@"control"];
  }
  if (flags & kCGEventFlagMaskAlternate) {
    [modifiers addObject:@"option"];
  }
  if (flags & kCGEventFlagMaskShift) {
    [modifiers addObject:@"shift"];
  }
  if (flags & kCGEventFlagMaskAlphaShift) {
    [modifiers addObject:@"capslock"];
  }
  if (flags & kCGEventFlagMaskSecondaryFn) {
    [modifiers addObject:@"function"];
  }
  return [modifiers componentsJoinedByString:@"+"];
}

static NSString *KeyCharacters(CGEventRef event) {
  UniChar buffer[8];
  UniCharCount actualLength = 0;
  CGEventKeyboardGetUnicodeString(event, 8, &actualLength, buffer);
  if (actualLength == 0) {
    return @"";
  }
  return [NSString stringWithCharacters:buffer length:actualLength];
}

static NSDictionary *BaseRecordPayload(NSString *kind, CGEventRef event) {
  double elapsedMs = (CFAbsoluteTimeGetCurrent() - recordStartTime) * 1000.0;
  CGEventTimestamp eventTimestamp = CGEventGetTimestamp(event);
  CGEventFlags flags = CGEventGetFlags(event);

  return @{
    @"kind": kind,
    @"timestampMs": @((long long)llround(elapsedMs)),
    @"eventTimestampNs": @((unsigned long long)eventTimestamp),
    @"modifiers": ModifierNames(flags)
  };
}

static void PrintMouseRecord(NSString *kind, CGEventRef event) {
  NSMutableDictionary *payload = [BaseRecordPayload(kind, event) mutableCopy];
  CGPoint point = CGEventGetLocation(event);
  NSInteger pixelX = (NSInteger)llround((point.x - recordDesktopBounds.origin.x) * recordScaleX);
  NSInteger pixelY = (NSInteger)llround((point.y - recordDesktopBounds.origin.y) * recordScaleY);
  CGMouseButton button = (CGMouseButton)CGEventGetIntegerValueField(event, kCGMouseEventButtonNumber);
  int64_t clickState = CGEventGetIntegerValueField(event, kCGMouseEventClickState);

  payload[@"button"] = MouseButtonName(button);
  payload[@"clickState"] = @(clickState);
  payload[@"screenPoint"] = @{
    @"x": @((double)point.x),
    @"y": @((double)point.y)
  };
  payload[@"pixelPoint"] = @{
    @"x": @(pixelX),
    @"y": @(pixelY)
  };
  payload[@"pixelArea"] = @{
    @"x": @(pixelX),
    @"y": @(pixelY),
    @"width": @1,
    @"height": @1
  };

  PrintJSONLine(payload);
}

static void PrintKeyRecord(NSString *kind, CGEventRef event) {
  NSMutableDictionary *payload = [BaseRecordPayload(kind, event) mutableCopy];
  int64_t keyCode = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  bool autorepeat = CGEventGetIntegerValueField(event, kCGKeyboardEventAutorepeat) != 0;

  payload[@"keyCode"] = @(keyCode);
  payload[@"key"] = KeyCharacters(event);
  payload[@"autorepeat"] = @(autorepeat);

  PrintJSONLine(payload);
}

static void PrintScrollRecord(CGEventRef event) {
  NSMutableDictionary *payload = [BaseRecordPayload(@"scroll", event) mutableCopy];
  CGPoint point = CGEventGetLocation(event);
  NSInteger pixelX = (NSInteger)llround((point.x - recordDesktopBounds.origin.x) * recordScaleX);
  NSInteger pixelY = (NSInteger)llround((point.y - recordDesktopBounds.origin.y) * recordScaleY);

  payload[@"screenPoint"] = @{
    @"x": @((double)point.x),
    @"y": @((double)point.y)
  };
  payload[@"pixelPoint"] = @{
    @"x": @(pixelX),
    @"y": @(pixelY)
  };
  payload[@"deltaX"] = @(CGEventGetIntegerValueField(event, kCGScrollWheelEventPointDeltaAxis2));
  payload[@"deltaY"] = @(CGEventGetIntegerValueField(event, kCGScrollWheelEventPointDeltaAxis1));

  PrintJSONLine(payload);
}

static CGEventRef RecordEventCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
  (void)proxy;
  (void)refcon;

  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    CFMachPortRef tap = (CFMachPortRef)refcon ?: recordEventTap;
    if (tap) {
      CGEventTapEnable(tap, true);
    }
    return event;
  }

  switch (type) {
    case kCGEventLeftMouseDown:
    case kCGEventRightMouseDown:
    case kCGEventOtherMouseDown:
      PrintMouseRecord(@"mouse_down", event);
      break;
    case kCGEventLeftMouseUp:
    case kCGEventRightMouseUp:
    case kCGEventOtherMouseUp:
      PrintMouseRecord(@"mouse_up", event);
      break;
    case kCGEventLeftMouseDragged:
    case kCGEventRightMouseDragged:
    case kCGEventOtherMouseDragged:
      PrintMouseRecord(@"mouse_drag", event);
      break;
    case kCGEventKeyDown:
      PrintKeyRecord(@"key_down", event);
      break;
    case kCGEventScrollWheel:
      PrintScrollRecord(event);
      break;
    default:
      break;
  }

  return event;
}

static void Record(void) {
  recordStartTime = CFAbsoluteTimeGetCurrent();
  recordDesktopBounds = DesktopBoundsForRecording();
  CGImageRef image = CGWindowListCreateImage(
    recordDesktopBounds,
    kCGWindowListOptionOnScreenOnly,
    kCGNullWindowID,
    kCGWindowImageBestResolution
  );

  if (image) {
    recordScaleX = (double)CGImageGetWidth(image) / MAX((double)recordDesktopBounds.size.width, 1.0);
    recordScaleY = (double)CGImageGetHeight(image) / MAX((double)recordDesktopBounds.size.height, 1.0);
    CGImageRelease(image);
  }

  CGEventMask mask =
    CGEventMaskBit(kCGEventLeftMouseDown) |
    CGEventMaskBit(kCGEventLeftMouseUp) |
    CGEventMaskBit(kCGEventRightMouseDown) |
    CGEventMaskBit(kCGEventRightMouseUp) |
    CGEventMaskBit(kCGEventOtherMouseDown) |
    CGEventMaskBit(kCGEventOtherMouseUp) |
    CGEventMaskBit(kCGEventLeftMouseDragged) |
    CGEventMaskBit(kCGEventRightMouseDragged) |
    CGEventMaskBit(kCGEventOtherMouseDragged) |
    CGEventMaskBit(kCGEventKeyDown) |
    CGEventMaskBit(kCGEventScrollWheel);

  CFMachPortRef eventTap = CGEventTapCreate(
    kCGHIDEventTap,
    kCGHeadInsertEventTap,
    kCGEventTapOptionListenOnly,
    mask,
    RecordEventCallback,
    NULL
  );

  if (!eventTap) {
    Fail(@"Unable to record input. Grant Accessibility and Input Monitoring permission to the app or terminal launching Electron.");
  }
  recordEventTap = eventTap;

  CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0);
  if (!source) {
    CFRelease(eventTap);
    Fail(@"Unable to create recording run loop source.");
  }

  PrintJSONLine(@{
    @"kind": @"recording_started",
    @"desktopBounds": @{
      @"originX": @(recordDesktopBounds.origin.x),
      @"originY": @(recordDesktopBounds.origin.y),
      @"width": @(recordDesktopBounds.size.width),
      @"height": @(recordDesktopBounds.size.height)
    },
    @"scale": @{
      @"x": @(recordScaleX),
      @"y": @(recordScaleY)
    }
  });

  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
  CGEventTapEnable(eventTap, true);
  CFRunLoopRun();

  CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
  CFRelease(source);
  CFRelease(eventTap);
  recordEventTap = NULL;
}

static CGPoint ParsePoint(NSArray<NSString *> *args, NSUInteger index) {
  return CGPointMake(ArgDouble(args, index, @"x"), ArgDouble(args, index + 1, @"y"));
}

static void PostMouse(CGEventType type, CGPoint point, CGMouseButton button, int64_t clickState) {
  CGEventRef event = CGEventCreateMouseEvent(NULL, type, point, button);
  if (!event) {
    Fail(@"Unable to create mouse event.");
  }
  CGEventSetIntegerValueField(event, kCGMouseEventClickState, clickState);
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
}

static void Move(NSArray<NSString *> *args) {
  CGPoint target = ParsePoint(args, 1);
  CGWarpMouseCursorPosition(target);
  CGAssociateMouseAndMouseCursorPosition(true);
  PostMouse(kCGEventMouseMoved, target, kCGMouseButtonLeft, 1);
}

static void Click(NSArray<NSString *> *args, int64_t count) {
  CGPoint target = ParsePoint(args, 1);
  CGWarpMouseCursorPosition(target);
  CGAssociateMouseAndMouseCursorPosition(true);
  PostMouse(kCGEventMouseMoved, target, kCGMouseButtonLeft, 1);

  for (int64_t index = 1; index <= count; index++) {
    PostMouse(kCGEventLeftMouseDown, target, kCGMouseButtonLeft, index);
    usleep(35000);
    PostMouse(kCGEventLeftMouseUp, target, kCGMouseButtonLeft, index);
    usleep(45000);
  }
}

static void Drag(NSArray<NSString *> *args) {
  CGPoint start = ParsePoint(args, 1);
  CGPoint end = ParsePoint(args, 3);

  PostMouse(kCGEventMouseMoved, start, kCGMouseButtonLeft, 1);
  PostMouse(kCGEventLeftMouseDown, start, kCGMouseButtonLeft, 1);

  for (int step = 1; step <= 12; step++) {
    CGFloat ratio = (CGFloat)step / 12.0;
    CGPoint current = CGPointMake(
      start.x + (end.x - start.x) * ratio,
      start.y + (end.y - start.y) * ratio
    );
    PostMouse(kCGEventLeftMouseDragged, current, kCGMouseButtonLeft, 1);
    usleep(12000);
  }

  PostMouse(kCGEventLeftMouseUp, end, kCGMouseButtonLeft, 1);
}

static void Scroll(NSArray<NSString *> *args) {
  int32_t deltaX = (int32_t)ArgDouble(args, 1, @"deltaX");
  int32_t deltaY = (int32_t)ArgDouble(args, 2, @"deltaY");
  CGEventRef event = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 2, deltaY, deltaX);
  if (!event) {
    Fail(@"Unable to create scroll event.");
  }
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
}

static void TypeText(NSArray<NSString *> *args) {
  if ([args count] <= 1) {
    return;
  }

  NSString *text = args[1];
  for (NSUInteger index = 0; index < [text length]; index++) {
    UniChar character = [text characterAtIndex:index];

    CGEventRef down = CGEventCreateKeyboardEvent(NULL, 0, true);
    CGEventKeyboardSetUnicodeString(down, 1, &character);
    CGEventPost(kCGHIDEventTap, down);
    CFRelease(down);

    CGEventRef up = CGEventCreateKeyboardEvent(NULL, 0, false);
    CGEventKeyboardSetUnicodeString(up, 1, &character);
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(up);
  }
}

static NSDictionary<NSString *, NSNumber *> *KeyCodes(void) {
  return @{
    @"a": @0, @"s": @1, @"d": @2, @"f": @3, @"h": @4, @"g": @5, @"z": @6, @"x": @7,
    @"c": @8, @"v": @9, @"b": @11, @"q": @12, @"w": @13, @"e": @14, @"r": @15,
    @"y": @16, @"t": @17, @"1": @18, @"2": @19, @"3": @20, @"4": @21, @"6": @22,
    @"5": @23, @"=": @24, @"9": @25, @"7": @26, @"-": @27, @"8": @28, @"0": @29,
    @"]": @30, @"o": @31, @"u": @32, @"[": @33, @"i": @34, @"p": @35,
    @"return": @36, @"enter": @36, @"l": @37, @"j": @38, @"'": @39, @"k": @40,
    @";": @41, @"\\": @42, @",": @43, @"/": @44, @"n": @45, @"m": @46, @".": @47,
    @"tab": @48, @"space": @49, @"`": @50, @"delete": @51, @"backspace": @51,
    @"escape": @53, @"esc": @53, @"command": @55, @"cmd": @55, @"shift": @56,
    @"capslock": @57, @"option": @58, @"alt": @58, @"control": @59, @"ctrl": @59,
    @"rightshift": @60, @"rightoption": @61, @"rightalt": @61, @"rightcontrol": @62,
    @"rightctrl": @62, @"function": @63, @"f17": @64, @"volumeup": @72,
    @"volumedown": @73, @"mute": @74, @"f18": @79, @"f19": @80, @"f20": @90,
    @"f5": @96, @"f6": @97, @"f7": @98, @"f3": @99, @"f8": @100, @"f9": @101,
    @"f11": @103, @"f13": @105, @"f16": @106, @"f14": @107, @"f10": @109,
    @"f12": @111, @"f15": @113, @"help": @114, @"home": @115, @"pageup": @116,
    @"forwarddelete": @117, @"end": @119, @"pagedown": @121, @"left": @123,
    @"right": @124, @"down": @125, @"up": @126
  };
}

static CGKeyCode KeyCode(NSString *key) {
  NSNumber *code = KeyCodes()[[key lowercaseString]];
  if (!code) {
    Fail([NSString stringWithFormat:@"Unsupported key: %@", key]);
  }
  return (CGKeyCode)[code unsignedShortValue];
}

static void PostKey(NSString *key, bool down) {
  CGEventRef event = CGEventCreateKeyboardEvent(NULL, KeyCode(key), down);
  if (!event) {
    Fail(@"Unable to create keyboard event.");
  }
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
}

static void Keypress(NSArray<NSString *> *args) {
  if ([args count] <= 1) {
    return;
  }

  NSArray<NSString *> *keys = [args subarrayWithRange:NSMakeRange(1, [args count] - 1)];
  NSString *primary = [keys lastObject];
  NSArray<NSString *> *modifiers = [keys subarrayWithRange:NSMakeRange(0, [keys count] - 1)];

  for (NSString *modifier in modifiers) {
    PostKey(modifier, true);
  }

  PostKey(primary, true);
  PostKey(primary, false);

  for (NSString *modifier in [modifiers reverseObjectEnumerator]) {
    PostKey(modifier, false);
  }
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSMutableArray<NSString *> *args = [NSMutableArray array];
    for (int index = 1; index < argc; index++) {
      [args addObject:[NSString stringWithUTF8String:argv[index]]];
    }

    if ([args count] == 0) {
      Fail(@"Expected command.");
    }

    NSString *command = args[0];
    if ([command isEqualToString:@"screenshot"]) {
      Screenshot();
    } else if ([command isEqualToString:@"move"]) {
      Move(args);
    } else if ([command isEqualToString:@"click"]) {
      Click(args, 1);
    } else if ([command isEqualToString:@"double_click"]) {
      Click(args, 2);
    } else if ([command isEqualToString:@"drag"]) {
      Drag(args);
    } else if ([command isEqualToString:@"scroll"]) {
      Scroll(args);
    } else if ([command isEqualToString:@"type"]) {
      TypeText(args);
    } else if ([command isEqualToString:@"keypress"]) {
      Keypress(args);
    } else if ([command isEqualToString:@"record"]) {
      Record();
    } else {
      Fail([NSString stringWithFormat:@"Unsupported command: %@", command]);
    }
  }

  return 0;
}
