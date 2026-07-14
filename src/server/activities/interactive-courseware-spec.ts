export type InteractiveActivityType =
  | "single_choice"
  | "multiple_choice"
  | "true_false"
  | "fill_blank"
  | "drag_match";

export type ActivityOption = {
  id: string;
  text: string;
};

type BaseActivity = {
  id: string;
  type: InteractiveActivityType;
  learningObjectiveIds: string[];
  timeLimitSeconds: number;
  endCondition: string;
};

export type SingleChoiceActivity = BaseActivity & {
  type: "single_choice";
  stem: string;
  options: ActivityOption[];
  correctOptionIds: string[];
};

export type MultipleChoiceActivity = BaseActivity & {
  type: "multiple_choice";
  stem: string;
  options: ActivityOption[];
  correctOptionIds: string[];
};

export type TrueFalseActivity = BaseActivity & {
  type: "true_false";
  stem: string;
  correctValue: boolean;
};

export type FillBlankActivity = BaseActivity & {
  type: "fill_blank";
  stem: string;
  acceptedAnswers: string[];
};

export type DragMatchActivity = BaseActivity & {
  type: "drag_match";
  pairs: Array<{ leftId: string; rightId: string }>;
};

export type InteractiveActivity =
  | SingleChoiceActivity
  | MultipleChoiceActivity
  | TrueFalseActivity
  | FillBlankActivity
  | DragMatchActivity;

export type InteractiveCoursewareSpec = {
  schemaVersion: "interactive-courseware.v1";
  title: string;
  learningObjectives: Array<{ id: string; text: string }>;
  pages: Array<{
    id: string;
    title: string;
    activities: InteractiveActivity[];
  }>;
};

export type InteractiveCoursewareValidationError = {
  code:
    | "EMPTY_TITLE"
    | "DUPLICATE_PAGE_ID"
    | "DUPLICATE_ACTIVITY_ID"
    | "EMPTY_PAGE"
    | "MISSING_OBJECTIVE_MAPPING"
    | "UNKNOWN_OBJECTIVE"
    | "INVALID_TIME_LIMIT"
    | "MISSING_END_CONDITION"
    | "EMPTY_STEM"
    | "EMPTY_OPTIONS"
    | "DUPLICATE_OPTION_ID"
    | "INVALID_CORRECT_OPTION"
    | "INVALID_CORRECT_VALUE"
    | "EMPTY_ACCEPTED_ANSWERS"
    | "EMPTY_DRAG_MATCH_PAIRS";
  path: string;
  message: string;
};

export type InteractiveCoursewareValidationResult = {
  ok: boolean;
  errors: InteractiveCoursewareValidationError[];
};

export function validateInteractiveCoursewareSpec(
  spec: InteractiveCoursewareSpec,
): InteractiveCoursewareValidationResult {
  const errors: InteractiveCoursewareValidationError[] = [];
  const objectiveIds = new Set(spec.learningObjectives.map((objective) => objective.id));
  const pageIds = new Set<string>();
  const activityIds = new Set<string>();

  if (!spec.title.trim()) {
    errors.push(error("EMPTY_TITLE", "title", "Courseware title is required."));
  }

  spec.pages.forEach((page, pageIndex) => {
    const pagePath = `pages[${pageIndex}]`;
    if (pageIds.has(page.id)) {
      errors.push(error("DUPLICATE_PAGE_ID", `${pagePath}.id`, "Page ids must be unique."));
    }
    pageIds.add(page.id);

    if (page.activities.length === 0) {
      errors.push(error("EMPTY_PAGE", `${pagePath}.activities`, "Every page needs at least one activity."));
    }

    page.activities.forEach((activity, activityIndex) => {
      const activityPath = `${pagePath}.activities[${activityIndex}]`;
      if (activityIds.has(activity.id)) {
        errors.push(error("DUPLICATE_ACTIVITY_ID", `${activityPath}.id`, "Activity ids must be unique across the courseware."));
      }
      activityIds.add(activity.id);
      validateBaseActivity(activity, activityPath, objectiveIds, errors);
      validateActivityAnswer(activity, activityPath, errors);
    });
  });

  return { ok: errors.length === 0, errors };
}

function validateBaseActivity(
  activity: InteractiveActivity,
  path: string,
  objectiveIds: Set<string>,
  errors: InteractiveCoursewareValidationError[],
) {
  if (activity.learningObjectiveIds.length === 0) {
    errors.push(error("MISSING_OBJECTIVE_MAPPING", `${path}.learningObjectiveIds`, "Every activity must map to at least one learning objective."));
  }
  activity.learningObjectiveIds.forEach((objectiveId, index) => {
    if (!objectiveIds.has(objectiveId)) {
      errors.push(error("UNKNOWN_OBJECTIVE", `${path}.learningObjectiveIds[${index}]`, "Activity references an unknown learning objective."));
    }
  });
  if (!Number.isInteger(activity.timeLimitSeconds) || activity.timeLimitSeconds <= 0) {
    errors.push(error("INVALID_TIME_LIMIT", `${path}.timeLimitSeconds`, "Time limit must be a positive whole number."));
  }
  if (!activity.endCondition.trim()) {
    errors.push(error("MISSING_END_CONDITION", `${path}.endCondition`, "Every activity must define an end condition."));
  }
}

function validateActivityAnswer(
  activity: InteractiveActivity,
  path: string,
  errors: InteractiveCoursewareValidationError[],
) {
  switch (activity.type) {
    case "single_choice":
    case "multiple_choice":
      validateChoiceActivity(activity, path, errors);
      return;
    case "true_false":
      if (typeof activity.correctValue !== "boolean") {
        errors.push(error("INVALID_CORRECT_VALUE", `${path}.correctValue`, "True/false activities require a boolean answer."));
      }
      return;
    case "fill_blank":
      if (activity.acceptedAnswers.filter((answer) => answer.trim()).length === 0) {
        errors.push(error("EMPTY_ACCEPTED_ANSWERS", `${path}.acceptedAnswers`, "Fill-blank activities require at least one accepted answer."));
      }
      return;
    case "drag_match":
      if (activity.pairs.length === 0) {
        errors.push(error("EMPTY_DRAG_MATCH_PAIRS", `${path}.pairs`, "Drag-match activities require at least one pair."));
      }
      return;
  }
}

function validateChoiceActivity(
  activity: SingleChoiceActivity | MultipleChoiceActivity,
  path: string,
  errors: InteractiveCoursewareValidationError[],
) {
  if (!activity.stem.trim()) {
    errors.push(error("EMPTY_STEM", `${path}.stem`, "Question stem is required."));
  }
  if (activity.options.length === 0) {
    errors.push(error("EMPTY_OPTIONS", `${path}.options`, "Choice activities require options."));
  }
  const optionIds = new Set<string>();
  activity.options.forEach((option, index) => {
    if (optionIds.has(option.id)) {
      errors.push(error("DUPLICATE_OPTION_ID", `${path}.options[${index}].id`, "Option ids must be unique in an activity."));
    }
    optionIds.add(option.id);
  });
  activity.correctOptionIds.forEach((optionId, index) => {
    if (!optionIds.has(optionId)) {
      errors.push(error("INVALID_CORRECT_OPTION", `${path}.correctOptionIds[${index}]`, "Correct option must exist in options."));
    }
  });
}

function error(
  code: InteractiveCoursewareValidationError["code"],
  path: string,
  message: string,
): InteractiveCoursewareValidationError {
  return { code, path, message };
}
