/**
 * How the student says they feel — "I hate algebra", "this is boring", "lol", "I'm so bad at maths".
 *
 * Read by explicit, ordered phrase rules (no model), shared by all three lessons. The reply is an
 * ENCOURAGE move: acknowledge it in one or two short sentences, then hand back a smaller version of the
 * task. Light humour is used only for dislike, boredom and laughter, only the first time or two, and is
 * always about the subject — never about the child, their mistakes or their ability. Worry and frustration
 * get no jokes. The tutor never claims to be human and never encourages dependence ("you need me").
 */
export type AffectKind = "worried" | "frustrated" | "dislike" | "bored" | "laugh";

const SUBJECT = "(algebra|maths?|math|equations?|physics|forces?|geometry|angles?|triangles?|this subject|school|homework)";

const RULES: Array<[AffectKind, RegExp]> = [
  ["worried", new RegExp(`\\b(i'?m|i am) (so |really |just )?(dumb|stupid|thick|useless|bad at ${SUBJECT}|rubbish at|terrible at|useless at|not good at|not smart)|i (always|keep) (getting|get) (it|these|them|everything) wrong|i can'?t do ${SUBJECT}|(i'?m|i am) (scared|nervous|worried|afraid)|i'?ll (never|not) (get|understand) (it|this)|i'?m going to fail`)],
  ["frustrated", /\b(ugh+|argh+|this is (so |really )?(stupid|annoying|impossible|too hard)|i hate this|so annoying|too hard|so hard|i give up|whatever)\b/],
  ["dislike", new RegExp(`\\b(hate|can'?t stand|don'?t like|do not like|dislike|detest) ${SUBJECT}|${SUBJECT} (is|are) (the worst|stupid|pointless|useless|dumb|annoying|evil)|${SUBJECT} sucks|why do (we|i) (even )?(need|have) to (learn|do|know) (this|${SUBJECT.slice(1, -1)})|what'?s the point of (this|${SUBJECT.slice(1, -1)})`)],
  ["bored", /\b(boring|so bored|i'?m bored|this is dull|snooze|zzz+)\b/],
  ["laugh", /^(lol|lmao|lmfao|rofl|haha+|hehe+|xd)\b|😂|🤣/],
];

export function readAffect(text: string): AffectKind | null {
  const t = text.trim().toLowerCase().replace(/[’‘]/g, "'");
  for (const [k, re] of RULES) if (re.test(t)) return k;
  return null;
}

type Subject = "algebra" | "physics" | "geometry";

const LINES: Record<AffectKind, Record<Subject | "any", string[]>> = {
  dislike: {
    algebra: [
      "Fair. Sometimes it looks like maths decided to start using the alphabet. But this is really a little mystery: x is hiding a number, and two moves will find it.",
      "I get it — letters in maths can feel like a trick. Here x is just a box with a number inside.",
      "Noted. Let's make this one as painless as possible.",
    ],
    physics: [
      "Fair. But you already know a lot of physics — you've been pushing and pulling things your whole life. This just puts numbers on it.",
      "Noted. Let's keep it short and use the picture.",
    ],
    geometry: [
      "Fair. The good news: triangles are very predictable. One rule does almost all the work here.",
      "Noted. Let's keep it short — one rule, one question.",
    ],
    any: ["Noted. Let's keep it short."],
  },
  bored: {
    algebra: ["Fair enough — this isn't exactly a film. Let's make it quick, then.", "Okay, speed run. Two moves and this one's done."],
    physics: ["Fair enough. Quick one, then — it's a tug of war with numbers.", "Okay, speed run."],
    geometry: ["Fair enough. Quick one, then — one rule and some subtraction.", "Okay, speed run."],
    any: ["Fair enough. Let's make it quick."],
  },
  laugh: {
    algebra: ["Ha. Okay — x is still hiding, though.", "Glad someone's having fun. Back to it."],
    physics: ["Ha. Okay — the box is still waiting.", "Glad someone's having fun. Back to it."],
    geometry: ["Ha. Okay — that angle is still missing.", "Glad someone's having fun. Back to it."],
    any: ["Ha. Okay, back to it."],
  },
  worried: {
    any: [
      "Getting things wrong is part of how this works — nothing here is a test, and every line gets checked with you.",
      "Lots of people feel like that at first, and it changes with practice.",
      "You're doing the thinking, and that's the part that counts.",
    ],
    algebra: [],
    physics: [],
    geometry: [],
  },
  frustrated: {
    any: ["That's fair — this part is genuinely tricky.", "Okay, deep breath.", "I hear you."],
    algebra: [],
    physics: [],
    geometry: [],
  },
};

/** The acknowledgement for this feeling, varied by how many times feelings have come up this session. */
export function affectLine(kind: AffectKind, subject: Subject, count: number): string {
  const own = LINES[kind][subject];
  const list = own.length ? own : LINES[kind].any;
  return list[Math.min(count, list.length - 1)];
}

/** Does this line contain humour? (Used by tests: never for worry or frustration.) */
export const HUMOROUS: AffectKind[] = ["dislike", "bored", "laugh"];
