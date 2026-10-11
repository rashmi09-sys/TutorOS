import type { MisconceptionId } from "./misconceptions";

/**
 * Plain-language names of the misconceptions, for the student's progress page. Client-safe: only the labels,
 * never the probes or teaching focus (those stay in misconceptions.ts, on the server). A unit test keeps these
 * identical to the catalogue.
 */
export const MISCONCEPTION_LABELS: Record<MisconceptionId, string> = {
  SIGN_ERROR_INVERSE_OP: "Used the same operation instead of its inverse",
  FORGOT_TO_DIVIDE: "Stopped before undoing the multiplication",
  MULTIPLIED_INSTEAD_OF_DIVIDING: "Multiplied where dividing was needed",
  COEFFICIENT_AS_ADDEND: "Read a number next to x as adding instead of multiplying",
  COMBINED_UNLIKE_TERMS: "Added the x-term and the plain number together",
  UNDID_IN_WRONG_ORDER: "Divided only part of one side",
  EVALUATION_ORDER_CONFUSION: "Used the order for working out an expression (BODMAS) to solve an equation",
  ONE_SIDE_ONLY: "Changed one side but not the other",
  INVERTED_DIVISION: "Divided the wrong way round",
  ARITHMETIC_SLIP: "Right idea, small calculation slip",
  UNCLASSIFIED: "Not sure yet — need to hear the reasoning",
};
