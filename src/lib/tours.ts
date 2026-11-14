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
];

export const tourById = (id: string) => TOURS.find((t) => t.id === id);

/** Best walkthrough for a question, if any (used when the AI can't answer) */
export function tourForQuestion(q: string): Tour | undefined {
  return TOURS.find((t) => t.keywords.test(q));
}

/** Ask the player (mounted in the admin layout) to play a walkthrough */
export function playTour(id: string) {
  window.dispatchEvent(new CustomEvent("att:tour", { detail: id }));
}
