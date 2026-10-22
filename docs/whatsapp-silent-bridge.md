# Silent WhatsApp document dispatch

The client generates its document PDF in an offscreen canvas. Its existing
Activity-owned WebView remains in the root hierarchy. The invoice, voucher,
journal and statement send paths do not open an authentication panel, external
WhatsApp application, share sheet or PDF preview.

The transport adapter is `native/android/whatsapp-direct.js` version 4. Native
Android first verifies and injects the bundled `@wppconnect/wa-js` version 4.7.1.
It then passes one request ID, normalized Yemen number, PDF bytes, filename and
caption to the adapter. There is no runtime CDN fetch and no undocumented
`window.Store`/socket discovery code in the Qatfah adapter.

## Pinned dependency

The original npm tarball is
`https://registry.npmjs.org/@wppconnect/wa-js/-/wa-js-4.7.1.tgz`.
Its SHA-512 integrity and individual SHA-256 hashes are recorded in
`native/android/vendor/manifest.json`. Build injection verifies every asset and
includes both the Apache license and the bundled dependency notices. The native
engine also verifies the JavaScript asset SHA-256 before evaluating it.

This is the WPPConnect project's unofficial WhatsApp Web integration, not a Meta
Cloud API credential or an official availability guarantee. WhatsApp Web changes
can require a reviewed dependency update and another device acceptance test.

## Sending contract

1. Validate `9677XXXXXXXX`, PDF header/size, filename, caption and request ID.
2. Wait for the pinned WPP loader and authenticated, synchronized online session.
3. Query `WPP.contact.queryWidExists(phone + '@c.us')` and require its phone ID to
   match exactly. A returned LID is accepted only as an alias of that exact phone.
4. Call `WPP.chat.sendFileMessage(jid, 'data:application/pdf;base64,...', options)`
   once, with `type:'document'`, `mimetype:'application/pdf'`, the original caption
   and filename, and `waitForAck:true`. No chat navigation or preview is required.
5. Accept success only when the returned serialized message ID matches the
   verified recipient and `ack` is between 1 and 4. `ack == 1` is server
   acceptance; `ack >= 2` confirms recipient delivery. Opening UI, resolving an
   empty Promise, and returning an unrelated message ID never count as success.

The native response includes `submitted`, `ack`, `messageId`, `dispatched`,
`deliveryConfirmed`, `requestId`, `phase`, `code` and `failedStage`. It never claims
recipient delivery from server acceptance. Visible diagnostics omit PDF content.

An exception after the library call, missing acknowledgement, or timeout is
`uncertain`, with instructions to check the conversation before another attempt.
There is no automatic fallback or resend. The button/native locks release in
`finally`; an unresolved WPP network Promise retains its own dispatch guard so a
second attempt cannot duplicate an upload still running in the background.

## Verification and its limits

`tests/whatsapp-send.test.mjs` executes the exact adapter using a simulated WPP
transport boundary. It verifies five distinct recipient/PDF/caption cycles,
blocked UI/navigation operations, delayed readiness, phone-to-LID mapping,
acknowledgement mismatch, missing acknowledgement, timeout and concurrency.
`tests/whatsapp-session.test.mjs` exercises pairing persistence and the frontend
sender. `tests/lifecycle-native.test.mjs` verifies the native injector and asset
integrity.

These are automated adapter/integration tests. They do not demonstrate that a
real WhatsApp account accepted a PDF on an Android device. Live acceptance must
record the tested APK hash, Android/WebView version, a consented test recipient,
message ID and acknowledgement for each requested send cycle. An unavailable
live session is reported as blocked, not passed.

## Primary API references

- https://wppconnect.io/wa-js/functions/chat.sendFileMessage.html
- https://wppconnect.io/wa-js/interfaces/chat.FileMessageOptions.html
- https://wppconnect.io/wa-js/interfaces/chat.SendMessageReturn.html
- https://github.com/wppconnect-team/wa-js/tree/v4.7.1

The npm package's TypeScript declarations are the pinned API source for
`queryWidExists`, `isAuthenticated`, `isMainReady`, and `isOnline`.
