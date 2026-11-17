/**
 * Guided "show me how" walkthroughs. Each step opens a page and points at one
 * element, found by its data-tour marker (exact) or, failing that, by its
 * visible text.
 *
 * - action "tap": the lecturer taps the highlighted control to go on
 *   (or presses "Do it for me"); the walkthrough waits for them.
 * - action "look": just explains; moves on by itself after a few seconds.
 * - missing: what to tell the lecturer when the control isn't on screen.
 */
export type TourStep = {
  path: string;
  tour?: string;
  text?: string;
  caption: string;
  action?: "tap" | "look";
  missing?: string;
};
export type Tour = { id: string; title: string; keywords: RegExp; steps: TourStep[] };

const NEEDS_LIVE = "This button only shows while a check-in is running. Create a link first (Links → New link), then come back to Live session.";

export const TOURS: Tour[] = [
  {
    id: "create_link",
    title: "Create a check-in link",
    keywords: /\b(create|new|make|generate)\b.*\blink\b|\blink\b.*\b(create|new|make)|start (a )?class|start check.?in/i,
    steps: [
      { path: "/admin/links", tour: "new-link", action: "tap", caption: "1. Tap New link." },
      { path: "/admin/links", tour: "link-type-attendance", action: "tap", caption: "2. Tap Attendance (choose Test only for a test link)." },
      { path: "/admin/links", tour: "class-code-yes", action: "tap", caption: "3. Tap Yes, assign class codes so each student gets their own code." },
      { path: "/admin/links", tour: "verify-location", action: "tap", caption: "4. Stand in the lecture hall and tap Verify my location. Wait until it says Verified (about ±30 m or better)." },
      { path: "/admin/links", tour: "expires-in", action: "look", caption: "5. Choose how long the link stays open, e.g. 15 minutes." },
      { path: "/admin/links", tour: "projector-code", action: "look", caption: "6. Leave Ask for the projector code off. Students just enter their matric number and take a selfie." },
      { path: "/admin/links", tour: "generate-link", action: "tap", caption: "7. Tap Generate link. Then share it in your class WhatsApp group, or show its QR code." },
    ],
  },
  {
    id: "review_checkins",
    title: "Review flagged check-ins",
    keywords: /\breview|approve|reject|unverified|face mismatch|suspicious/i,
    steps: [
      { path: "/admin/review", text: "To review", action: "look", caption: "1. To review lists check-ins that need your decision: unverified, face mismatch, different phone or suspicious location." },
      { path: "/admin/review", action: "look", caption: "2. Tap a student in the list. Compare their registered photo with today's selfie, and check the selfie background is your hall." },
      { path: "/admin/review", tour: "approve", action: "look", caption: "3. Same person and in the hall? Tap Approve.", missing: "Tap a student in the list first; their Approve and Reject buttons then appear." },
      { path: "/admin/review", tour: "reject", action: "look", caption: "4. Not the same person, or not in the hall? Tap Reject. The check-in is removed and they're marked absent.", missing: "Tap a student in the list first." },
    ],
  },
  {
    id: "export_records",
    title: "Download attendance",
    keywords: /\b(export|download|csv|excel|spreadsheet)\b/i,
    steps: [
      { path: "/admin/records", tour: "filters", action: "look", caption: "1. Optional: tap Filters to pick one course, level or class code first." },
      { path: "/admin/records", tour: "export", action: "tap", caption: "2. Tap Export." },
      { path: "/admin/records", action: "look", caption: "3. Tap CSV for what's on screen, or CSV, all time for everything. It opens in Excel or Google Sheets." },
    ],
  },
  {
    id: "add_record",
    title: "Add a student by hand",
    keywords: /\b(add|enter|record)\b.*\b(student|record|manually|by hand)\b|manual/i,
    steps: [
      { path: "/admin/records", tour: "add-record", action: "tap", caption: "1. Tap Add." },
      { path: "/admin/records", action: "look", caption: "2. Fill in name, matric number and course, then tap Save. It's marked Added by you." },
    ],
  },
  {
    id: "block_student",
    title: "Block a student from a check-in",
    keywords: /\b(block|sent out|send out|ban|unblock)\b/i,
    steps: [
      { path: "/admin/live", tour: "block-form", action: "look", caption: "1. Under Blocked students, type the student's matric number (and a reason if you like), then tap Block. They can't sign this check-in.", missing: NEEDS_LIVE },
      { path: "/admin/live", action: "look", caption: "2. To undo, tap Unblock next to their name in the same list." },
    ],
  },
  {
    id: "gps_help",
    title: "Help a student whose GPS fails",
    keywords: /\bgps\b|location (is )?(not|wrong|weak)|can'?t sign|scan (a )?student|out of range/i,
    steps: [
      { path: "/admin/live", action: "look", caption: "1. On the student's phone, their error screen shows Ask your lecturer to scan me. They tap it and a code appears." },
      { path: "/admin/live", tour: "scan-student", action: "tap", caption: "2. Tap Scan student and point your camera at their code.", missing: NEEDS_LIVE },
      { path: "/admin/live", action: "look", caption: "3. Compare the two photos and tap Approve. They're signed in at your location, labelled GPS help." },
    ],
  },
  {
    id: "notify_students",
    title: "Send a notification to students",
    keywords: /\b(notify|notification|alert|announce|push)\b/i,
    steps: [
      { path: "/admin/live", tour: "notify", action: "tap", caption: "1. Tap Notify students.", missing: NEEDS_LIVE },
      { path: "/admin/live", action: "look", caption: "2. Type a short title like \"CSC401 check-in is open\" and tap Send. Students who turned on notifications get it on their phone." },
    ],
  },
  {
    id: "create_test",
    title: "Create a test",
    keywords: /\b(test|quiz|exam|c1|c2|c3|question|pdf)\b/i,
    steps: [
      { path: "/admin/manage", tour: "new-test", action: "tap", caption: "1. Tap New test. (Or tap Upload PDF to import questions from a PDF.)" },
      { path: "/admin/manage", action: "look", caption: "2. Type the title, course code, time limit and C1, C2 or C3." },
      { path: "/admin/manage", tour: "add-theory", action: "look", caption: "3. Add questions: Add multiple-choice question, or Add theory question for written answers." },
      { path: "/admin/manage", tour: "save-test", action: "tap", caption: "4. Tap Save test, then write your warning about cheating and tap Save warning." },
      { path: "/admin/manage", tour: "test-toggle", action: "look", caption: "5. When students should start, switch the test on here, or create a test link in Links.", missing: "Save a test first; it then appears in the list with this switch." },
    ],
  },
  {
    id: "class_settings",
    title: "Change class location or radius",
    keywords: /\b(radius|class location|distance|range|venue)\b/i,
    steps: [
      { path: "/admin/manage", tour: "auto-detect", action: "tap", caption: "1. In the lecture hall, tap Auto-detect my location." },
      { path: "/admin/manage", tour: "radius", action: "look", caption: "2. Set Allowed radius in metres. 100 m covers a normal lecture hall." },
      { path: "/admin/manage", tour: "save-settings", action: "tap", caption: "3. Tap Save settings." },
    ],
  },
  {
    id: "upload_material",
    title: "Upload study materials",
    keywords: /\b(material|notes|handout|upload|sell)\b/i,
    steps: [
      { path: "/admin/materials", tour: "add-material", action: "tap", caption: "1. Tap Add New Material." },
      { path: "/admin/materials", action: "look", caption: "2. Add a title and the file, choose Free or Paid (paid needs your bank), then tap Save Material." },
    ],
  },
  {
    id: "run_checkin",
    title: "Run a live check-in",
    keywords: /\b(live session|extend|more time|\+ ?5|end (the )?check.?in|close (the )?check.?in|stop check.?in)\b/i,
    steps: [
      { path: "/admin/live", action: "look", caption: "1. Live session shows the running check-in: your pin, the allowed circle and each student who signed." },
      { path: "/admin/live", tour: "extend", action: "look", caption: "2. Students running late? Tap +5 minutes.", missing: NEEDS_LIVE },
      { path: "/admin/live", tour: "end-checkin", action: "look", caption: "3. When you're done, tap End check-in. Nobody can sign after that.", missing: NEEDS_LIVE },
    ],
  },
  {
    id: "projector",
    title: "Show the link on the projector",
    keywords: /\b(projector|screen|qr|room code|4.?letter)\b/i,
    steps: [
      { path: "/admin/live", tour: "open-projector", action: "tap", caption: "1. Tap Open projector.", missing: NEEDS_LIVE },
      { path: "/admin/projector", action: "look", caption: "2. Put this page on the projector. Students scan the QR code to open the sign-in page." },
    ],
  },
  {
    id: "student_phone_reset",
    title: "Reset a student who changed phones",
    keywords: /\b(changed|new|lost|different) phone\b|\breset (a )?student|registered students/i,
    steps: [
      { path: "/admin/students", text: "Registered students", action: "look", caption: "1. Students page lists everyone who registered with a face scan." },
      { path: "/admin/students", text: "Approve reset", action: "tap", caption: "2. A student asked for a reset after changing phones? Tap Approve reset. They can then register again on the new phone.", missing: "No student has asked for a reset right now. To reset someone yourself, find them below and tap Reset." },
    ],
  },
  {
    id: "mark_theory",
    title: "Mark theory answers",
    keywords: /\b(mark|grade|score)\b.*\b(theory|written|essay|answer)\b|\b(theory|written)\b.*\b(mark|grade)\b|edit (a )?score/i,
    steps: [
      { path: "/admin/records", action: "look", caption: "1. In Records, a test score with * still has written answers to mark. Tap that student." },
      { path: "/admin/records", action: "look", caption: "2. In their panel, tap the test score that says \"to mark\"." },
      { path: "/admin/records", action: "look", caption: "3. Read each answer and how it was typed. Tap Suggest mark + AI check for a suggestion." },
      { path: "/admin/records", action: "look", caption: "4. Type your mark for each answer and tap Save result." },
    ],
  },
  {
    id: "class_codes",
    title: "Turn on personal class codes",
    keywords: /\bclass code/i,
    steps: [
      { path: "/admin/manage", tour: "class-code-toggle", action: "look", caption: "1. Here in Class settings, switch Class code to Active and choose the format, then tap Save settings." },
      { path: "/admin/links", tour: "new-link", action: "look", caption: "2. When you create a link, tap Yes, assign class codes. Each student's code then fills in by itself when they type their matric number." },
    ],
  },
  {
    id: "open_lock_form",
    title: "Open or lock the sign-in form",
    keywords: /\b(open|lock|close) (the )?form\b|form (is )?(locked|closed)/i,
    steps: [
      { path: "/admin/manage", tour: "open-form", action: "look", caption: "1. Open form lets students sign for the time you set." },
      { path: "/admin/manage", tour: "lock-form", action: "look", caption: "2. Lock form stops all sign-ins straight away." },
    ],
  },
  {
    id: "custom_fields",
    title: "Ask students for extra details",
    keywords: /\b(custom|extra) (field|detail|question)|add (a )?field/i,
    steps: [
      { path: "/admin/manage", tour: "custom-fields", action: "look", caption: "1. Custom form fields add questions to the sign-in form, like Faculty or State of origin. Tap + Add field." },
      { path: "/admin/manage", tour: "save-settings", action: "tap", caption: "2. Name the field, choose if it's required, then tap Save settings." },
    ],
  },
  {
    id: "earnings_payout",
    title: "See earnings and get paid",
    keywords: /\b(earning|payout|pay ?out|withdraw|money|bank|paid material|sales)\b/i,
    steps: [
      { path: "/admin/manage", tour: "earnings", action: "look", caption: "1. Earnings from materials shows total earned and what's still owed to you." },
      { path: "/admin/manage", tour: "payout", action: "look", caption: "2. Tap Pay out now to send it to the bank you added on Materials.", missing: "Nothing is owed right now, so there's no payout button yet." },
    ],
  },
  {
    id: "account",
    title: "Change your email or password",
    keywords: /\b(password|change (my )?email|sign.?in email|account)\b/i,
    steps: [
      { path: "/admin/manage", tour: "account-card", action: "tap", caption: "1. Tap Your account." },
      { path: "/admin/manage", action: "look", caption: "2. Next to Sign-in email or Password, tap Change. Enter your current password, then the new email or password, and save." },
    ],
  },
  {
    id: "install_app",
    title: "Install Attendly on your phone",
    keywords: /\b(install|home screen|download (the )?app|app icon)\b/i,
    steps: [
      { path: "/admin", text: "Install app", action: "tap", caption: "Open the menu and tap Install app to add Attendly to your home screen.", missing: "Open the menu (☰ at the top right) and tap Install app. On iPhone: Share, then Add to Home Screen." },
    ],
  },
];

export const tourById = (id: string) => TOURS.find((t) => t.id === id);

/** Best walkthrough for a question, if any (used when the AI can't answer) */
export function tourForQuestion(q: string): Tour | undefined {
  // Specific tasks first, so "mark theory answers" isn't taken by "create a test"
  const first = ["mark_theory", "class_codes", "student_phone_reset", "run_checkin", "projector", "open_lock_form", "custom_fields", "account", "earnings_payout"];
  const ordered = [...first.map(tourById).filter((t): t is Tour => !!t), ...TOURS.filter((t) => !first.includes(t.id))];
  return ordered.find((t) => t.keywords.test(q));
}

/** Ask the player (mounted in the admin layout) to play a walkthrough */
export function playTour(id: string) {
  window.dispatchEvent(new CustomEvent("att:tour", { detail: id }));
}
