/**
 * Guided "show me how" walkthroughs. Each step opens a page and points at an
 * element found by its visible text (a button, tab or heading). If the element
 * isn't on screen (for example no check-in is running), the caption still
 * explains the step.
 */
/** press: tap the target when moving on, so the next step can show what it opens */
export type TourStep = { path: string; target?: string; caption: string; press?: boolean };
export type Tour = { id: string; title: string; keywords: RegExp; steps: TourStep[] };

export const TOURS: Tour[] = [
  {
    id: "create_link",
    title: "Create a check-in link",
    keywords: /\b(create|new|make|generate)\b.*\blink\b|\blink\b.*\b(create|new|make)|start (a )?class|start check.?in/i,
    steps: [
      { path: "/admin/links", target: "Attendance links", caption: "Check-in links live on the Links page." },
      { path: "/admin/links", target: "New link", caption: "Tap New link to start one.", press: true },
      { path: "/admin/links", target: "Attendance", caption: "Choose Attendance (pick Test for a test link). Give it a title and course code.", press: true },
      { path: "/admin/links", target: "Verify my location", caption: "Stand in the lecture hall and tap Verify my location. Drag the pin if it's off, then pick the radius." },
      { path: "/admin/links", target: "Expires in", caption: "Choose how long the link stays open, then create it." },
      { path: "/admin/links", caption: "Share the link or tap its QR code to show it on the projector. Students can now sign in." },
    ],
  },
  {
    id: "review_checkins",
    title: "Review flagged check-ins",
    keywords: /\breview|approve|reject|unverified|face mismatch|suspicious/i,
    steps: [
      { path: "/admin/review", target: "To review", caption: "Check-ins that need a look are listed on To review." },
      { path: "/admin/review", caption: "Tap a student on the left. Compare their registered photo with the selfie they took." },
      { path: "/admin/review", caption: "Look at the selfie background: is it your lecture hall? Then tap Approve, or Reject to remove the check-in." },
    ],
  },
  {
    id: "export_records",
    title: "Download attendance",
    keywords: /\b(export|download|csv|excel|spreadsheet)\b/i,
    steps: [
      { path: "/admin/records", target: "Records", caption: "All check-ins are on the Records page." },
      { path: "/admin/records", target: "Filters", caption: "Optional: use Filters to pick a course, level or class code first." },
      { path: "/admin/records", target: "Export", caption: "Tap Export, then CSV. It opens in Excel or Google Sheets." },
    ],
  },
  {
    id: "add_record",
    title: "Add a student by hand",
    keywords: /\b(add|enter|record)\b.*\b(student|record|manually|by hand)\b|manual/i,
    steps: [
      { path: "/admin/records", target: "Add", caption: "On Records, tap Add.", press: true },
      { path: "/admin/records", caption: "Fill in the student's name, matric number and course, then save. It shows as Added by you." },
    ],
  },
  {
    id: "block_student",
    title: "Block a student from a check-in",
    keywords: /\b(block|sent out|send out|ban|unblock)\b/i,
    steps: [
      { path: "/admin/live", target: "Blocked students", caption: "Open Live session while a check-in is running, then tap Blocked students." },
      { path: "/admin/live", caption: "Type the matric number and tap Block. They can't sign this session. Unblock them here any time." },
    ],
  },
  {
    id: "gps_help",
    title: "Help a student whose GPS fails",
    keywords: /\bgps\b|location (is )?(not|wrong|weak)|can'?t sign|scan (a )?student|out of range/i,
    steps: [
      { path: "/admin/live", target: "Scan student", caption: "On Live session, tap Scan student." },
      { path: "/admin/live", caption: "The student taps \"Ask your lecturer to scan me\" on their error screen. Scan the code on their phone." },
      { path: "/admin/live", caption: "Compare the photos and tap Approve. They are signed in at your location and labelled GPS help." },
    ],
  },
  {
    id: "notify_students",
    title: "Send a notification to students",
    keywords: /\b(notify|notification|alert|announce|push)\b/i,
    steps: [
      { path: "/admin/live", target: "Notify students", caption: "On Live session, tap Notify students." },
      { path: "/admin/live", caption: "Write a short title like \"CSC401 check-in is open\" and send. Students who turned on notifications get it on their phone." },
    ],
  },
  {
    id: "create_test",
    title: "Create a test",
    keywords: /\b(test|quiz|exam|c1|c2|c3|theory|question|pdf)\b/i,
    steps: [
      { path: "/admin/manage", target: "Tests & quizzes", caption: "Tests are on Tests & settings, under Tests & quizzes." },
      { path: "/admin/manage", target: "New test", caption: "Tap New test to type questions, or Upload PDF to import them.", press: true },
      { path: "/admin/manage", caption: "Add multiple-choice or theory questions, then Save test. You'll be asked what to warn students about cheating." },
      { path: "/admin/manage", target: "Inactive", caption: "When you're ready, switch the test to Active so students can open it." },
    ],
  },
  {
    id: "class_settings",
    title: "Change class location or radius",
    keywords: /\b(radius|class location|settings|distance|range|venue)\b/i,
    steps: [
      { path: "/admin/manage", target: "Tests & settings", caption: "Open Tests & settings." },
      { path: "/admin/manage", target: "Auto-detect my location", caption: "In the hall, tap Auto-detect my location to set the class location." },
      { path: "/admin/manage", target: "Save settings", caption: "Set the allowed distance and tap Save settings." },
    ],
  },
  {
    id: "upload_material",
    title: "Upload study materials",
    keywords: /\b(material|notes|handout|upload|sell)\b/i,
    steps: [
      { path: "/admin/materials", target: "Study Materials", caption: "Study materials are on the Materials page." },
      { path: "/admin/materials", target: "Add New Material", caption: "Tap Add New Material, add a title and file, choose Free or Paid, then save." },
    ],
  },
  {
    id: "run_checkin",
    title: "Run a live check-in",
    keywords: /\b(live session|extend|more time|\+ ?5|end (the )?check.?in|close (the )?check.?in|stop check.?in)\b/i,
    steps: [
      { path: "/admin/live", caption: "Live session shows the check-in that's running now: your pin, the allowed circle and each student on the map." },
      { path: "/admin/live", target: "+5 minutes", caption: "Students running late? Tap +5 minutes to keep it open longer." },
      { path: "/admin/live", target: "End check-in", caption: "When class has started, tap End check-in. Nobody can sign after that." },
    ],
  },
  {
    id: "projector",
    title: "Show the code on the projector",
    keywords: /\b(projector|screen|qr|room code|4.?letter|code changes)\b/i,
    steps: [
      { path: "/admin/live", target: "Open projector", caption: "On Live session, tap Open projector." },
      { path: "/admin/projector", caption: "Put this page on the projector. Students scan the QR code and type the 4-letter code. It changes every 30 seconds, so a WhatsApp photo is useless." },
    ],
  },
  {
    id: "student_phone_reset",
    title: "Reset a student who changed phones",
    keywords: /\b(changed|new|lost|different) phone\b|\breset\b|registered students/i,
    steps: [
      { path: "/admin/students", target: "Registered students", caption: "Students who registered with a face scan are on the Students page." },
      { path: "/admin/students", target: "Approve reset", caption: "If a student asked for a reset after changing phones, tap Approve reset. They can then register again on the new phone." },
      { path: "/admin/students", caption: "To reset someone yourself, find them in the list and tap Reset." },
    ],
  },
  {
    id: "mark_theory",
    title: "Mark theory answers",
    keywords: /\b(mark|grade|score)\b.*\b(theory|written|essay|answer)\b|\b(theory|written)\b.*\b(mark|grade)\b|edit (a )?score/i,
    steps: [
      { path: "/admin/records", target: "Records", caption: "Test scores are on Records. A score with * still has written answers to mark." },
      { path: "/admin/records", caption: "Tap the student, then tap their test score (it says \"to mark\")." },
      { path: "/admin/records", caption: "Read each answer and how it was typed. Tap \"Suggest mark + AI check\" for a suggested mark and an AI-written rating." },
      { path: "/admin/records", caption: "Type your mark for each answer and tap Save result. The student's score updates." },
    ],
  },
  {
    id: "class_codes",
    title: "Turn on personal class codes",
    keywords: /\bclass code/i,
    steps: [
      { path: "/admin/manage", target: "Class code", caption: "In Tests & settings, find Class code." },
      { path: "/admin/manage", caption: "Switch it on and choose the format. Each student gets their own code, shown only on their phone when they sign in." },
    ],
  },
  {
    id: "open_lock_form",
    title: "Open or lock the sign-in form",
    keywords: /\b(open|lock|close) (the )?form\b|form (is )?(locked|closed)/i,
    steps: [
      { path: "/admin/manage", target: "Open form", caption: "Open form lets students sign for the time you set." },
      { path: "/admin/manage", target: "Lock form", caption: "Lock form stops all sign-ins straight away." },
    ],
  },
  {
    id: "custom_fields",
    title: "Ask students for extra details",
    keywords: /\b(custom|extra) (field|detail|question)|add (a )?field/i,
    steps: [
      { path: "/admin/manage", target: "Custom form fields", caption: "Custom form fields add questions to the sign-in form, like Faculty or State of origin." },
      { path: "/admin/manage", target: "Add field", caption: "Tap Add field, name it and choose if it's required, then Save settings." },
    ],
  },
  {
    id: "earnings_payout",
    title: "See earnings and get paid",
    keywords: /\b(earning|payout|pay ?out|withdraw|money|bank|paid material|sales)\b/i,
    steps: [
      { path: "/admin/manage", target: "Earnings from materials", caption: "Money from paid materials shows under Earnings from materials." },
      { path: "/admin/manage", caption: "Check Total earned and Still owed to you. Tap Pay out now to send it to the bank you added on Materials." },
    ],
  },
  {
    id: "change_password",
    title: "Change your password",
    keywords: /\bpassword\b/i,
    steps: [
      { path: "/admin/manage", target: "Change admin password", caption: "At the bottom of Class settings, tap Change admin password and enter the new one." },
    ],
  },
  {
    id: "install_app",
    title: "Install Attendly on your phone",
    keywords: /\b(install|home screen|download (the )?app|app icon)\b/i,
    steps: [
      { path: "/admin", target: "Install app", caption: "Tap Install app in the menu to add Attendly to your home screen. It opens like an app and works on slow data." },
    ],
  },
];

export const tourById = (id: string) => TOURS.find((t) => t.id === id);

/** Best walkthrough for a question, if any (used when the AI can't answer) */
export function tourForQuestion(q: string): Tour | undefined {
  // Specific tasks first, so "mark theory answers" isn't taken by "create a test"
  const first = ["mark_theory", "class_codes", "student_phone_reset", "run_checkin", "projector", "open_lock_form", "custom_fields", "change_password", "earnings_payout"];
  const ordered = [...first.map(tourById).filter((t): t is Tour => !!t), ...TOURS.filter((t) => !first.includes(t.id))];
  return ordered.find((t) => t.keywords.test(q));
}

/** Ask the player (mounted in the admin layout) to play a walkthrough */
export function playTour(id: string) {
  window.dispatchEvent(new CustomEvent("att:tour", { detail: id }));
}
