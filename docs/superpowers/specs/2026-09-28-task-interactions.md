# Task interactions — iOS first

Implemented on 2026-09-28. This supersedes the swipe-only Today interaction.

## Create

The center Add button and empty-state action open the same compact sheet. The title gets focus
within the opening tap, with sentence capitalization and a Done keyboard action. Enter submits;
IME composition does not. The default is a one-off task starting today.

A Schedule row shows the current repeat, start date, and optional due time. Tap to expand the
existing scheduling controls. Task editing starts expanded. Add task / Save changes stays pinned
below the scrolling fields, with a 48 px target. Save failures appear beside that action, so the
keyboard cannot hide the explanation. Duplicate submissions are blocked until the local write
finishes. Closing an unfinished new task keeps its draft for this group while the page stays open.
A successful save clears it. Changing groups resets it.

## Keyboard

The sheet follows Base UI's virtual keyboard inset instead of assuming a keyboard height. Its
bottom clears the keyboard; its maximum height reserves space at the screen's top safe area.
Only the fields scroll. Header, dismiss control, and primary action remain accessible. Keyboard
movement does not run a separate bottom-position animation that could lag the native keyboard.

The sheet already clears the keyboard, so additional overlap scroll padding would double-count
space during its entrance. Keep the body's bottom padding at 4 px. This avoids the temporary large
gap above Add task. Button pointer-down preserves the focused input; otherwise a blur can move the
button before pointer-up. Selecting another input, date, or time still uses native focus behavior.

## Complete and reopen

Tap the 48 px circle to complete. The existing check, progress update, and celebration remain.
The five-second Undo action restores the exact completion event. Tap a completed circle to reopen
it directly. Reopening uses neutral blue feedback and a short confirmation, without a destructive
warning. The title remains a separate link to task details with at least a 44 px height.

Right swipe remains available from anywhere on a row. Release beyond 88 px commits; reversing,
vertical scrolling, cancellation, and shorter drags leave state unchanged. A swipe never also
activates the circle or task link. Keyboard and assistive activation remain supported. Failed
local writes explain the failure and allow retry without celebrating.

## Verification

Web unit tests cover creation, schedules, drafts, validation, duplicate submissions, failures,
taps, swipes, keyboard activation, and Undo. Browser tests use Chromium and WebKit at 375 × 812,
including light/dark and reduced-motion layouts, a simulated 346 px visual-viewport reduction,
longer scheduling content, offline mutations, and resync. Chromium also verifies offline reload;
Playwright WebKit cannot navigate the service-worker page while its context is forced offline.

Desktop WebKit and a simulated visual viewport do not reproduce the iOS software keyboard.
Device verification remains for Safari and installed PWA: open from both Add actions, type and
submit, expand Schedule while typing, switch to date/time pickers, rotate, dismiss the keyboard,
and reopen a draft. Check that the page behind stays still and Add remains above the keyboard.

Keyboard behavior builds on the [Base UI drawer guidance](https://base-ui.com/react/components/drawer).
