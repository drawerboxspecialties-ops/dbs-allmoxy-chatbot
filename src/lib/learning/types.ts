export type LearningKind =
  | "alias"
  | "correction"
  | "preference"
  | "fact"
  | "feedback";

export type LearningEntry = {
  id: string;
  kind: LearningKind;
  /** Short trigger / topic, e.g. "C004321" or "ship date" */
  trigger: string;
  /** What the bot should remember */
  content: string;
  helpful: number;
  unhelpful: number;
  source: "staff" | "auto" | "feedback";
  createdAt: string;
  updatedAt: string;
};

export type LearningInput = {
  kind?: LearningKind;
  trigger: string;
  content: string;
  source?: LearningEntry["source"];
};
