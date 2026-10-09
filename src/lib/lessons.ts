import type { LessonId } from "@/engine/subjects/types";

export interface LessonInfo {
  id: LessonId;
  subject: string;
  title: string;
  goal: string;
  objective: string;
  difficulty: string;
  minutes: string;
  href: string;
  /** What the deterministic verifier checks, in plain words (Engineer View). */
  verifier: string;
  /** What the student will be asked to do, for the start screen. */
  intro: string;
}

export const LESSONS: LessonInfo[] = [
  {
    id: "algebra",
    subject: "Algebra",
    title: "Two-step equations",
    goal: "Solve equations like 3x + 5 = 20 by undoing each step, one line at a time.",
    objective: "Solve two-step linear equations by applying inverse operations to both sides, then show it on fresh problems without help.",
    difficulty: "Grade 7",
    minutes: "10–15 min",
    href: "/learn/algebra",
    verifier: "Exact equation parser and solver (rational arithmetic): every line is checked for equivalence with the problem",
    intro: "You write each line of working, and I check it exactly. When there's something worth noticing, I'll ask a question, give a nudge or show a check.",
  },
  {
    id: "physics",
    subject: "Physics",
    title: "Forces and balance",
    goal: "Combine pushes into a net force, and work out what balanced forces do to something already moving.",
    objective: "Combine forces along a line into a net force, and use balanced vs unbalanced forces to predict what happens to an object's motion.",
    difficulty: "Grade 7–8",
    minutes: "8–10 min",
    href: "/learn/physics",
    verifier: "Net force on a line, computed exactly (size and direction checked separately); motion questions matched against a closed list of outcomes",
    intro: "Look at the arrows, then tell me the net force or what happens next. I check numbers and directions exactly; for questions about motion I'll tell you which kinds of answers I can check.",
  },
  {
    id: "geometry",
    subject: "Geometry",
    title: "Angles in a triangle",
    goal: "Find a missing angle using the 180° rule — including right-angled and isosceles triangles.",
    objective: "Find a missing angle using the fact that a triangle's angles add up to 180°, including right-angled and isosceles triangles.",
    difficulty: "Grade 6–7",
    minutes: "8–10 min",
    href: "/learn/geometry",
    verifier: "Angle-sum rule (180°) computed exactly, with the isosceles base-angle rule; recognised mistakes matched by value",
    intro: "Work out the missing angle and tell me — with your working if you like. I check every angle and every calculation you write.",
  },
];

export const lessonInfo = (id: LessonId) => LESSONS.find((l) => l.id === id)!;
