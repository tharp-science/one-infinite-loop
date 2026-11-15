// One Infinite Loop Key: a tap on the right Command key alone types ⌘.
//
// Holding right Command for a shortcut still works: only a tap of under half
// a second, with no other key, modifier, click or scroll in between, types
// the character. It watches the keyboard and the mouse buttons for that and
// nothing else, keeps nothing, writes nothing, and makes no network request.
//
// Build: swiftc -O RightCommandKey.swift -o OneInfiniteLoopKey
// Check the tap logic without touching the keyboard: OneInfiniteLoopKey --self-test

import CoreGraphics
import Foundation

let rightCommandKey: Int64 = 54
let deviceLeftCommand: UInt64 = 0x08   // NX_DEVICELCMDKEYMASK
let deviceRightCommand: UInt64 = 0x10  // NX_DEVICERCMDKEYMASK
let tapLimitNs: UInt64 = 500_000_000
let otherModifiers: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskSecondaryFn]

/// What the helper reacts to, stripped of CoreGraphics, so the rule can be tested.
enum Seen {
    case rightCommand(isDown: Bool, rawFlags: UInt64, otherModifiersHeld: Bool, at: UInt64)
    case other
}

/// The rule: right Command went down alone and came up again soon, nothing in between.
struct TapRule {
    private var pressedAt: UInt64?

    /// Answers true when this event completes a tap that should type ⌘.
    mutating func feed(_ seen: Seen) -> Bool {
        switch seen {
        case .other:
            pressedAt = nil
            return false
        case let .rightCommand(isDown, rawFlags, otherHeld, at):
            if isDown {
                let alone = rawFlags & deviceLeftCommand == 0 && !otherHeld
                pressedAt = alone ? at : nil
                return false
            }
            defer { pressedAt = nil }
            guard let start = pressedAt else { return false }
            return at >= start && at - start <= tapLimitNs
        }
    }
}

func selfTest() -> Int32 {
    var failures = 0
    func check(_ name: String, _ events: [Seen], _ expected: [Bool]) {
        var rule = TapRule()
        let got = events.map { rule.feed($0) }
        if got != expected {
            failures += 1
            print("FAIL \(name): expected \(expected), got \(got)")
        } else {
            print("ok   \(name)")
        }
    }
    let ms: UInt64 = 1_000_000
    let down = { (t: UInt64) in Seen.rightCommand(isDown: true, rawFlags: deviceRightCommand, otherModifiersHeld: false, at: t) }
    let up = { (t: UInt64) in Seen.rightCommand(isDown: false, rawFlags: 0, otherModifiersHeld: false, at: t) }
    check("a quick tap types the loop", [down(0), up(120 * ms)], [false, true])
    check("a long hold does not", [down(0), up(700 * ms)], [false, false])
    check("a shortcut in between does not", [down(0), .other, up(100 * ms)], [false, false, false])
    check("left Command also held does not",
          [.rightCommand(isDown: true, rawFlags: deviceRightCommand | deviceLeftCommand, otherModifiersHeld: false, at: 0), up(100 * ms)],
          [false, false])
    check("Shift also held does not",
          [.rightCommand(isDown: true, rawFlags: deviceRightCommand, otherModifiersHeld: true, at: 0), up(100 * ms)],
          [false, false])
    check("a release with no press does not", [up(100 * ms)], [false])
    check("two taps type two loops", [down(0), up(100 * ms), down(300 * ms), up(400 * ms)], [false, true, false, true])
    return failures == 0 ? 0 : 1
}

if CommandLine.arguments.contains("--self-test") {
    exit(selfTest())
}

/// Types ⌘ as text, with no modifier on the event, so it is never read as a shortcut.
func typeLoop() {
    let source = CGEventSource(stateID: .hidSystemState)
    var loop: [UniChar] = Array("⌘".utf16)
    for isDown in [true, false] {
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: isDown) else { continue }
        event.flags = []
        event.keyboardSetUnicodeString(stringLength: loop.count, unicodeString: &loop)
        event.post(tap: .cghidEventTap)
    }
}

var rule = TapRule()
var tap: CFMachPort?

let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    let seen: Seen
    if type == .flagsChanged && event.getIntegerValueField(.keyboardEventKeycode) == rightCommandKey {
        let raw = event.flags.rawValue
        seen = .rightCommand(
            isDown: raw & deviceRightCommand != 0,
            rawFlags: raw,
            otherModifiersHeld: !event.flags.intersection(otherModifiers).isEmpty,
            at: DispatchTime.now().uptimeNanoseconds)
    } else {
        seen = .other
    }
    if rule.feed(seen) {
        // Let the Command-up finish before the character goes in.
        DispatchQueue.main.async { typeLoop() }
    }
    return Unmanaged.passUnretained(event)
}

let watched: [CGEventType] = [.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]
let mask = watched.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }

// Ask once for the two permissions; macOS shows its own prompt and the
// System Settings entry, under this app's name. Then wait until both are given.
var asked = false
while !(CGPreflightListenEventAccess() && CGPreflightPostEventAccess()) {
    if !asked {
        _ = CGRequestListenEventAccess()
        _ = CGRequestPostEventAccess()
        asked = true
        FileHandle.standardError.write("One Infinite Loop Key: waiting for Input Monitoring and Accessibility in System Settings > Privacy & Security.\n".data(using: .utf8)!)
    }
    Thread.sleep(forTimeInterval: 2)
}

guard let created = CGEvent.tapCreate(
    tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
    eventsOfInterest: mask, callback: callback, userInfo: nil)
else {
    FileHandle.standardError.write("One Infinite Loop Key: could not watch the keyboard.\n".data(using: .utf8)!)
    exit(1)
}
tap = created
let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: created, enable: true)
CFRunLoopRun()
