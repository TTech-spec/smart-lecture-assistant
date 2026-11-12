/**
 * What the AI assistant knows about Attendly: pages, how to do things, and
 * fixes for common problems. Keep it in plain words; the AI quotes from it.
 */
export const AI_PAGES: { path: string; label: string }[] = [
  { path: "/admin", label: "Overview" },
  { path: "/admin/live", label: "Live session" },
  { path: "/admin/review", label: "To review" },
  { path: "/admin/records", label: "Records" },
  { path: "/admin/students", label: "Students" },
  { path: "/admin/links", label: "Links" },
  { path: "/admin/manage", label: "Tests & settings" },
  { path: "/admin/materials", label: "Materials" },
  { path: "/admin/projector", label: "Projector screen" },
];

export const AI_APP_GUIDE = `
ATTENDLY: GPS-verified class attendance for EKSU lecturers.

ADMIN PAGES (lecturer, after signing in at /admin)
- Overview (/admin): today's numbers, the live check-in with its projector code, people who need review, latest check-ins. "Start check-in" button.
- Live session (/admin/live): the running check-in on a map (your pin, the allowed circle, each student), live feed, +5 minutes, End check-in, Open projector, and "Blocked students" (block a matric number from this session; unblock any time).
- To review (/admin/review): check-ins flagged for face mismatch, different phone, suspicious location (GPS never moved, typed-in coordinates, same spot as another student, exactly on your pin, not on campus network) or a changed matric number. Compare the photos and Approve or Reject.
- Records (/admin/records): every check-in. Summary tiles, search, All/Verified/Review tabs, Filters (level, course, department, gender, link, class code), Export (CSV/JSON), Add a record by hand, tap a student for full details, edit test scores, Ask AI. Updates live every 10 seconds.
- Students (/admin/students): students who registered with a face scan; reset a student who changed phones.
- Links (/admin/links): create a check-in link. Verify your location on the map first (drag the pin if needed, choose the radius, save the venue for next time), set how long it stays open, then share the link or show its QR code.
- Tests & settings (/admin/manage): class location and allowed radius, campus internet addresses (optional, flags off-campus check-ins), how long the form stays open, course code, level, topic, custom form fields, class codes on/off and format, tests (C1/C2/C3), earnings from paid materials and "Pay out now".
- Materials (/admin/materials): upload study materials, free or paid. Paid ones need your bank (with the account name checked against the bank) and go in private storage.
- Projector screen (/admin/projector): full-screen QR code and the 4-letter code that changes every 30 seconds.

HOW A STUDENT SIGNS IN
1. Sign attendance page shows their live location (map, address, signal strength).
2. They open the class link or scan the projector QR.
3. Step 1: type matric number; their details and personal class code fill in.
4. Step 2: live selfie with a location stamp.
5. Step 3: type the projector code; the server checks distance, code and face, then saves.
Students register once at /register (name, matric, department, level, phone, gender, face scan). /me lets them see their check-ins and fix name, matric or department.

COMMON TASKS
- Start class: Links > New link > verify location > create > Open projector (or Overview > Start check-in).
- Someone was sent out: Live session > Blocked students > type matric > Block. Unblock there later.
- Check suspicious sign-ins: To review > open each > look at the selfie background > Approve/Reject.
- Download attendance: Records > Export > CSV.
- Change radius or class location: Tests & settings > Class settings.
- Turn on class codes: Tests & settings > class code toggle.

FIXES FOR COMMON PROBLEMS
- "Database table missing" or "couldn't get its class-code secret" when creating a link: run fix-link-creation.sql in Supabase SQL Editor, then create a NEW link.
- QR code opens ".../attend/undefined" or "link does not exist": update to the latest version (Vercel redeploy, hard refresh), delete links made before the fix, create a new one, and create links from the published site address, not the editor preview.
- Weak GPS (e.g. ±97 m): use a phone (laptops have no GPS), go near a window or the door, turn on Precise Location (iPhone: Settings > Privacy > Location Services > Safari/Chrome > Precise) or Google Location Accuracy (Android), wait 10-20 s. Up to ±150 m is still accepted.
- Student "out of range": check the radius in Tests & settings and that you verified your location in the hall when creating the link.
- Everyone locked out after wrong codes on campus Wi-Fi: run scale-2000.sql (it relaxes the shared-network lock).
- "This page isn't switched on yet" on My attendance: run student-edits.sql. Blocking not working: run session-blocks.sql. Class codes "not switched on": run class-codes.sql.
- Order of SQL files: security-hardening.sql, students-migration.sql, security-fixes.sql (then make sure your account is in the lecturers table), student-edits.sql, session-blocks.sql, class-codes.sql, payments-secure.sql, scale-2000.sql, fix-link-creation.sql.
- "function is_lecturer() does not exist": run security-fixes.sql first.
- Can't see admin pages after security-fixes.sql: add your account: insert into lecturers (user_id) select id from auth.users where email = 'YOUR EMAIL'.
- "Payment system not configured": on Vercel set SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL and SQUAD_SECRET_KEY (never with a VITE_ prefix), then redeploy. "API key is empty or invalid": use the Squad SECRET key (sandbox_sk_ or sk_), not the public key. OPay bank code is 100004.
- Paid upload fails: run payments-secure.sql (creates the private materials-paid storage).
- Ask AI says not set up: set the "openrouterai" key on Vercel and redeploy; OpenRouter needs credit.
- Changes not showing: wait for the Vercel deploy to finish, then hard refresh (Ctrl+Shift+R) or close all tabs on a phone. The version is shown at the bottom of the Register page.
- Face scan stuck: good light on the face, hold the phone at eye level, remove glasses or caps, try again.
`.trim();
