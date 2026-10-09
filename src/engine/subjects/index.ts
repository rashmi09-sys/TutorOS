import { geometry } from "./geometry";
import { physics } from "./physics";
import type { SubjectModule } from "./kernel";
import type { SubjectLessonId } from "./types";

export const SUBJECTS: Record<SubjectLessonId, SubjectModule> = { geometry, physics };
export { createSubjectSession, stepSubject, readMessage } from "./kernel";
export type { SubjectModule } from "./kernel";
export * from "./types";
